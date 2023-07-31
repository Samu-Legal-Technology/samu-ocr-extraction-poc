// Shared Confidence scores set by environment variables
// These environment variables are unique to the Lambda
export const MIN_ENTITY_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_ENTITY_CONFIDENCE_SCORE!
);
export const MIN_CONCEPT_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_CONCEPT_CONFIDENCE_SCORE!
);
export const MIN_TRAIT_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_TRAIT_CONFIDENCE_SCORE!
);
export const MIN_ATTRIBUTE_CONFIDENCE_SCORE = parseFloat(
  process.env.MIN_ATTRIBUTE_CONFIDENCE_SCORE!
);

interface Scored {
  Score?: number;
}

// Given a Comprehend Medical entity, filter all the attributes
// based on the desired confidence score
export function getConfidentAttributes<A extends Scored>(entity: {
  Attributes?: A[];
}): A[] | undefined {
  return entity.Attributes?.filter(
    (concept) => concept.Score && concept.Score > MIN_ATTRIBUTE_CONFIDENCE_SCORE
  );
}

// Given a Comprehend Medical entity, filter all the traits
// based on the desired confidence score
export function getConfidentTraits<T extends Scored>(entity: {
  Traits?: T[];
}): T[] | undefined {
  return entity.Traits?.filter(
    (concept) => concept.Score && concept.Score > MIN_TRAIT_CONFIDENCE_SCORE
  );
}

// Given a Comprehend Medical entity, filter all the Concepts
// based on the desired confidence score.
// Concepts will be different depending on the API used.
export function getConfidentConcepts<C extends Scored>(concepts?: C[]) {
  return concepts?.filter(
    (concept) => concept.Score && concept.Score > MIN_CONCEPT_CONFIDENCE_SCORE
  );
}
