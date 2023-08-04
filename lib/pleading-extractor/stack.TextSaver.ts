import { Handler, SNSEvent } from 'aws-lambda';
import * as db from '../dynamodb-persistor';
import { TextExtractor, TextractRecord } from '../text-extractor';
import * as s3 from '../aws/s3';
import * as Utils from '../utils';
import { Block } from '@aws-sdk/client-textract';
import { TextComprehend } from '../text-comprehend';

const extractor = new TextExtractor({});
const comprehend = new TextComprehend();

const blockTypeFilter = (type: string) => (block: Block) =>
  block.BlockType?.toUpperCase() === type.toUpperCase();

function getPageText(blocks: Block[]) {
  const pages: string[] = [];
  blocks
    .filter((block) => block.BlockType === 'LINE' && block.Text)
    .forEach((block: Block) => {
      const pageIndex = block.Page;
      if (pageIndex) {
        const page = pages.at(pageIndex) || '';
        pages[pageIndex] = page + ` \n ` + block.Text;
      }
    });
  return pages;
}

// Search blocks for queries and responses
function getQueries(blocks: Block[]) {
  const queries = blocks.filter(blockTypeFilter('QUERY'));
  const queryResults = blocks.filter(blockTypeFilter('QUERY_RESULT'));
  return queries.reduce((results, block) => {
    const answerIds = block.Relationships?.find(
      (relation) => relation.Type === 'ANSWER'
    )?.Ids;
    console.debug('Answer ids', answerIds);
    const answers = answerIds?.map((id) =>
      queryResults.find((resultBlock) => resultBlock.Id === id)
    );
    console.debug('answers', answers);
    return {
      ...results,
      [block.Query!.Alias!]: answers?.map((block) => block?.Text) || [],
    };
  }, {});
}

class BadFormatError extends Error { }

const vsPatterns = ['vs.', 'v.'];
const removeVsLine = (blocks: Block[]) => {
  const index = blocks.findIndex((block) =>
    vsPatterns.some((pattern) => block.Text?.toLowerCase().startsWith(pattern))
  );
  if (index < 0) throw new BadFormatError('Unable to find vs line');
  blocks.splice(index, 1);
};
const getCaseNumber = (blocks: Block[]) => {
  const index = blocks.findIndex(
    (block) =>
      block.Text?.toLowerCase().startsWith('cause') ||
      block.Text?.toLowerCase().startsWith('case')
  );
  if (index < 0) throw new BadFormatError('Unable to find case number');
  const line = blocks.splice(index, 1);
  return line[0];
};
const getDivisionNumber = (blocks: Block[]) => {
  const index = blocks.findIndex(
    (block) => block.Text?.toLowerCase().startsWith('division')
  );
  if (index < 0) throw new BadFormatError('Unable to find division number');
  const line = blocks.splice(index, 1);
  return line[0];
};

const getDefendants = (blocks: Block[]) => {
  const plaintiffLineIndex = blocks.findIndex(
    (block) => block.Text?.toLowerCase().startsWith('plaintiff')
  );
  if (plaintiffLineIndex < 0)
    throw new BadFormatError('Unable to find defendant split');

  // The end of the header has already removed the 'defendant' line
  const defedantLines = blocks.splice(plaintiffLineIndex + 1);
  console.debug('defendants', defedantLines);
  return defedantLines.filter(
    (block) => !block.Text?.toLowerCase().startsWith('and,')
  );
};

const getPlaintiff = (blocks: Block[]) => {
  const plaintiffLineIndex = blocks.findIndex(
    (block) => block.Text?.toLowerCase().startsWith('plaintiff')
  );
  if (plaintiffLineIndex < 0)
    throw new BadFormatError('Unable to find plaintiff line');
  let plaintiffStartIndex = plaintiffLineIndex - 1;
  // For now, assume only one plaintiff.
  const plaintiffLine = blocks.splice(plaintiffStartIndex, 2);
  return plaintiffLine[0];
};

function getHeader(blocks: Block[]) {
  const lines = blocks.filter(blockTypeFilter('LINE'));
  // Filter out dividers
  const filteredLines = lines.filter((block) => block.Text !== ')');

  const defendantLineIndex = filteredLines.findIndex(
    (block) => block.Text?.toLocaleLowerCase().includes('defendant')
  );
  if (defendantLineIndex < 0) {
    throw new BadFormatError('Could not find defendent line');
  }
  let header = filteredLines.slice(0, defendantLineIndex);
  const causeNumberLine = getCaseNumber(header);
  removeVsLine(header);
  const divisionLine = getDivisionNumber(header);
  const defendantsLines = getDefendants(header);
  const plaintiffLine = getPlaintiff(header);

  console.debug(
    'Header fields',
    plaintiffLine,
    causeNumberLine,
    divisionLine,
    defendantsLines
  );
  return {
    plaintifs: plaintiffLine.Text,
    caseNumber: causeNumberLine.Text,
    division: divisionLine.Text,
    defendents: defendantsLines.map((block: Block) => block.Text),
  };
}

const findParagraphStart = (num: number) => (block: Block) =>
  block.Text?.startsWith(`${num}. `) || block.Text === `${num}.`;

export function getNumberedParagraphs(blocks: Block[]): string[] {
  const paragraphs: string[][] = [];
  let number = 1;
  let startIndex = blocks.findIndex(findParagraphStart(number));
  let endIndex = blocks.findIndex(findParagraphStart(++number));
  while (startIndex > 0 && endIndex > 0) {
    const paragraphBlocks = blocks.slice(startIndex, endIndex);
    paragraphs.push(paragraphBlocks.map((block) => block.Text!));

    startIndex = endIndex;
    endIndex = blocks.findIndex(findParagraphStart(++number));
  }
  endIndex = startIndex;
  while (!['.', '?'].some((puct) => blocks[endIndex]?.Text?.endsWith(puct))) { }
  if (blocks[++endIndex]?.Text?.toLowerCase().startsWith('answer')) {
    console.debug(
      'block ends with . or : ?',
      blocks[endIndex]?.Text?.endsWith('.'),
      blocks[endIndex]?.Text?.endsWith(':')
    );
    while (
      !['.', '?', ':'].some(
        (puctuation) => blocks[endIndex]?.Text?.endsWith(puctuation)
      )
    )
      endIndex++;
  }
  const paragraph = blocks.slice(startIndex, endIndex);
  paragraphs.push(paragraph.map((block) => block.Text!));

  return paragraphs.map((lines) => lines.join(' '));
}

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
  console.log('Event: ', JSON.stringify(event));
  const results = event.Records.map(async (record) => {
    const jobData = JSON.parse(record.Sns.Message) as TextractRecord;
    const docId = jobData.JobTag;
    console.debug('Document ID', docId);

    const blocks = await extractor.fetchAnalysisJobOutput({
      jobId: jobData.JobId,
      documentId: docId,
    });
    console.debug(`found ${blocks.length} blocks`);
    const pages = getPageText(blocks);
    const queries = getQueries(blocks);
    console.debug(`Found queries`, queries);
    const header = getHeader(blocks);

    const entities: string[] = (
      await Promise.all(
        pages.map(async (page) => {
          const pageEntities = await comprehend.extractEntities([
            { Text: page },
          ]);
          return pageEntities;
        })
      )
    ).flat();
    const paragraphs = getNumberedParagraphs(
      blocks.filter(blockTypeFilter('LINE'))
    );
    console.debug('paragraphs', paragraphs);

    const [persistResult, ...saveLocations] = await Promise.allSettled([
      db.update(
        process.env.DOC_INFO_TABLE_NAME,
        docId,
        Utils.toDynamo({
          rawText: `https://s3.console.aws.amazon.com/s3/object/${process.env.STORAGE_BUCKET}?prefix=${docId}/textract`,
          header: {
            ...queries,
            ...header,
          },
          entities: new Set(entities),
          paragraphs,
        })
      ),
      ...pages.map((page, i) =>
        s3.saveText(page, `${docId}/textract/extracted${i}.txt`)
      ),
    ]);
    console.debug('Finished persiting', persistResult, saveLocations);
    if (
      saveLocations.some((saveLocation) => saveLocation.status != 'fulfilled')
    ) {
      throw Error('Failed to save text output to intermediate bucket');
    }
  });
  return Promise.all(results);
};
