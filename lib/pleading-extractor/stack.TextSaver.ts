import { Handler, SNSEvent } from 'aws-lambda';
import * as db from '../dynamodb-persistor';
import { TextExtractor, TextractRecord } from '../text-extractor';
import { extractBillingCodes } from '../aws/comprehend-medical';
import { startStateMachine } from '../aws/step-fuctions';
import * as s3 from '../aws/s3';
import * as Utils from '../utils';
import { Block } from '@aws-sdk/client-textract';

const extractor = new TextExtractor({});

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

function getHeader(blocks: Block[]) {
  const lines = blocks.filter(blockTypeFilter('LINE'));
  // Filter out dividers
  const filteredLines = lines.filter((block) => block.Text !== ')');

  // Format should be standard
  let [
    courtLine,
    stateLine,
    plaintifNameLine,
    plaintifLine,
    causeNumberLine,
    vsLine,
    divisionLine,
    ...rest
  ] = filteredLines;
  // Found format to be one of 2 ways. Need to swap if it is the other way
  if (vsLine.Text?.toLowerCase().includes('cause')) {
    console.debug('Swapping vs and cause');
    const tmp = vsLine;
    vsLine = causeNumberLine;
    causeNumberLine = tmp;
  }
  if (!divisionLine.Text?.toLowerCase().startsWith('division')) {
    console.debug('swapping division and defendent');
    const tmp = divisionLine;
    divisionLine = rest[0];
    rest[0] = tmp;
  }

  // May have more than one defendent
  const defendentsIndex = rest.findIndex(
    (block) => block.Text?.toLowerCase().startsWith('defendant')
  );
  const defendentsLines =
    defendentsIndex < 0 ? [] : rest.slice(0, defendentsIndex);
  console.debug('Defendent lines', defendentsIndex, defendentsLines);
  const defendents = defendentsLines.filter(
    (block) => !block.Text?.toLowerCase().includes('and')
  );
  console.debug(
    'Header fields',
    courtLine,
    stateLine,
    plaintifNameLine,
    plaintifLine,
    causeNumberLine,
    vsLine,
    divisionLine,
    defendents
  );
  return {
    court: courtLine.Text,
    state: stateLine.Text,
    plaintif: plaintifNameLine.Text,
    caseNumber: causeNumberLine.Text,
    division: divisionLine.Text,
    defendents: defendents.map((block) => block.Text),
  };
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

    const [persistResult, ...saveLocations] = await Promise.allSettled([
      db.update(
        process.env.DOC_INFO_TABLE_NAME,
        docId,
        Utils.toDynamo({
          rawText: `https://s3.console.aws.amazon.com/s3/object/${process.env.STORAGE_BUCKET}?prefix=${docId}/textract`,
          ...queries,
          header,
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
