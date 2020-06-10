const { StructuredSearchIndex, QueryResults, debugOutput, debugPassthrough } = require('./index');
const { readFileSync } = require('fs');
const util = require('util');

// Given an array of objects, build an index from each object's fields

function indexMTGCard(index, item) {
  // Customise string output functions for convenient debugging
  item[util.inspect.custom] = item.toString = function() { return `${this.name}: ${this.type} (${this.uuid})`; };

  indexString(index, item.name, item, 'name', normalise, tokenise);
  indexString(index, item.text, item, 'text', normalise, tokenise);
  indexString(index, item.layout, item, 'layout', normalise, tokenise);
  indexString(index, item.type, item, 'type', normalise, tokenise);

  if(item.legalities) {  // Author => author.last_name
    Object.keys(item.legalities).forEach(legality => indexString(index, legality, item, 'legality', normalise));
  }

}
function indexString(index, str, obj, category, normalise=s=>s.trim(), tokenise=s=>[s]) {
  if(str) {
    let terms = tokenise(normalise(str));
    let termCounts = countDistinctSearchTerms(terms);
    Object.entries(termCounts).forEach(([term, count]) => {
      return index.addObject(term, obj.uuid, obj, { count }, category);
    });
  }
  return index;
}
function countDistinctSearchTerms(allTokens) {
  const weights = {};
  for(token of allTokens) {
    weights[token] = weights[token] ? weights[token]+1 : 1;
  }
  return weights;
}

// Cumulatively add weight to search results
function weightSearchResult(existingWeight, subquery, category, countResultsFromAnySubquery, result) {
  return existingWeight + (countResultsFromAnySubquery / subquery.count) * result.metadata.count;
}


// Utility functions
function dump(obj, depth) {
  return util.inspect(obj, false, depth, true);
}

// Process args & set up runs
const args = process.argv.slice(2);

const QUERY = args[0] || 'the';
const CASE_SENSITIVE = typeof args[1] === 'undefined' ? true : Boolean(args[1] !== 'false');
const DEBUG_OUTPUT = typeof args[2] === 'undefined' ? true : Boolean(args[2] !== 'false');
const OBJECTS_FILE = args[3] || './assets/21300-mtg-cards.json';

// Set up some default normalisation and tokenisation functions
const normalise = CASE_SENSITIVE ? str=>str : str=>str.toLowerCase();
const tokenise = (str) => str.split(/[^a-z0-9]+/i);

const time = DEBUG_OUTPUT ? debugOutput : debugPassthrough;

// Load dictionary

const library = time(`Load library from file`, () => {
  return Object.values(JSON.parse(readFileSync(OBJECTS_FILE, { encoding:'utf8' })));
});

const structuredSearchIndex = new StructuredSearchIndex(library, indexMTGCard, time, normalise);
const subqueries = structuredSearchIndex.parseQueryTerms(QUERY);

// Perform subqueries
if(DEBUG_OUTPUT) {
console.log(`Perform subqueries:`);
}
time(`  ...Total subquery time`, () => structuredSearchIndex.performSubqueries(subqueries));

const queryResults = new QueryResults(subqueries, weightSearchResult, time);

// Now work out how to turn the data structure inside-out and combine the different result-sets into a single ordered list of documents
if(DEBUG_OUTPUT) {
console.log(`Normalise and weight subquery results:`);
}
time(`  ...Total time to normalise and weight`, () => queryResults.combineSubqueryResults());

const outputResults = time(`Sort ranked results`, () => queryResults.sortResults());

outputResults.slice(0,10).forEach(r => console.log(r.weight, r.document));
console.log(`\nResults: ${outputResults.length}`);