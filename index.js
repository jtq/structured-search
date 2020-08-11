// string-search: Fuzzy matching (Levenshtein distance by replacing up to N chracters with wildcards)
// string-search: manual weighting of categories when constructing index?
// DONE (custom weighting function): structured-search: manual weighting of categories in query?
// DONE structured-search: automatic weighting of subqueries by specificity (fewer results returned = higher weight because it's more selective)
// "exact string match" search (post-processing?)
// Scaling behaviour on full-text search?




const util = require('util');

const {
  addToIndex,
  lookupIterative,
  lookupRecursiveSingleCharWildcard,
  lookupRecursiveMultiCharWildcard
} = require('string-search');

// Utility functions
function dump(obj, depth) {
  return util.inspect(obj, false, depth, true);
}

const debugOutput = (title, func) => {
  const start = Date.now();
  const result = func();
  const took = Date.now()-start;
  console.log(`${title}: ${took}ms`);
  return result;
};
const debugPassthrough = (title, func) => func();

// Set up some default normalisation and tokenisation functions
const normalise = str=>str;

// Given an input term, return a string-search-compatible lookup function to handle it
const getLookupFunction = (str) => {
  if(str.includes('*')) {
    return lookupRecursiveMultiCharWildcard;
  }
  else if(str.includes('?')) {
    return lookupRecursiveSingleCharWildcard;
  }
  else {
    return lookupIterative;
  }
};

const weightSearchResult = (existingWeight) => existingWeight + 1;  // Simple search weighting - weight based on number of query terms that match this result

class StructuredSearchIndex {

  constructor(objects, indexObjectFunction, timeFunction, normaliseFunction=normalise, weightSearchResultFunction=weightSearchResult, parseQueryTermsFunction) {
    this.debugOutput = !!timeFunction && timeFunction !== debugPassthrough;
    this.run = timeFunction || debugPassthrough;
    this.normalise = normaliseFunction;
    this.weightSearchResult = weightSearchResultFunction;
    this.parseQueryTerms = parseQueryTermsFunction || this.defaultParseQueryTermsFunction;
    this.index = {};
    if(objects instanceof Array && indexObjectFunction instanceof Function) {
      this.run(`Build index of ${objects.length} items`, () => {
        for(let i=0; i<objects.length; i++) {
          indexObjectFunction(this, objects[i]);
        }
      });
    }
  }

  // searchTerm: the string we're indexing for this object
  // id: unique identifier value for this object (used when combining/deduping objects returned by multiple subqueries)
  // value: object we're indexing that is uniquely identified by 'id'
  // metadata: arbitrary metadata to index with this search-term/category/object (eg, count or weight of this search-term for this object/category)
  // category: the category to index searchTerm under
  addObject(searchTerm, id, value, metadata={}, category) {
    return addToIndex(this.index, searchTerm, { id, value, metadata }, category);
  }

  query(queryString) {
    const subqueries = this.parseQueryTerms(queryString);
    this.performSubqueries(subqueries);
    const queryResults = new QueryResults(subqueries, this.weightSearchResult);
    queryResults.combineSubqueryResults();
    return queryResults.sortResults();
  }

  // Parse raw input query terms into a useful structured form & work out the most performant lookup function that satisfies each term's requirements
  defaultParseQueryTermsFunction(inputString) {
    return this.run(`Parse query terms`, () => {
      return inputString.split(/\s+/).map(inputTerm => {
        const input = this.normalise(inputTerm);
        let required = null;
        let excluded = false;

        if(inputTerm[0] === "+") {
          required = true;
          inputTerm = inputTerm.substring(1);
        }

        if(inputTerm[0] === "-") {
          excluded = true;
          inputTerm = inputTerm.substring(1);
        }

        let [selector, term] = inputTerm.split(':');
        if(term) {
          term = this.normalise(term);
          selector = this.normalise(selector);
        }
        else {
          term = this.normalise(selector);
          selector = null;
        }

        const lookupFunction = getLookupFunction(term);
        return new Subquery(inputTerm, term, selector, required, excluded, lookupFunction);
      });
    });
  }

  performSubqueries(subqueries) {
    subqueries.forEach(subquery => {
      subquery.results = this.run(`  Query index for exact match ${subquery.required ? 'required' : ''} "${subquery.term}" ${subquery.selector ? 'in selector '+subquery.selector+' ' : 'in any field '}using ${subquery.lookupFunction.name}`, () => {
        const result = subquery.lookupFunction(this.index, subquery.term, true);
        if(subquery.selector) {
          const prefixedCategory = '_'+subquery.selector;
          return result.map(subresult => ({ [prefixedCategory]: subresult[prefixedCategory] })).filter(s => !!s[prefixedCategory]);
        }
        return result;
      });
      subquery.count = this.sumResultsInSet(subquery.results);
      if(this.debugOutput) {
        console.log(`    ...${subquery.count} results`);
      }
    });
  }

  // For a given set of results, sum the values for each word in each category in each input term
  sumResultsInSet(resultSet) {
    return resultSet.reduce((acc, s) => {
      return acc+Object.values(s).reduce((acc, c) => {
        return acc+Object.values(c).reduce((acc, set) => {
          return acc+set.size;
        }, 0);
      }, 0);
    }, 0);
  }
}

class Subquery {

  constructor(input, term, selector, required, excluded, lookupFunction) {
    this.input = input;
    this.term = term;
    this.selector = selector;
    this.required = required;
    this.excluded = excluded;
    this.lookupFunction = lookupFunction;

    this.results = null;
    this.count = undefined;
  }

}

class QueryResults {
  constructor(subqueries, weightSearchResult, timeFunction) {
    this.subqueries = subqueries;
    this.weightSearchResult = weightSearchResult;
    this.debugOutput = !!timeFunction && timeFunction !== debugPassthrough;
    this.run = timeFunction || debugPassthrough;
    this.rankedResults = {};
    this.excludedHits = {};
  }

  // For all subqueries, filter them based on subqueryPredicateFunction, perform resultProcessFunction on each of their results, then perform postProcessFunction after all have been processed
  processSubqueryResults(subqueryPredicateFunction=()=>true, resultProcessFunction=()=>{}, postProcessFunction=()=>{}) {
    for(let i=0; i<this.subqueries.length; i++) {
      const subquery = this.subqueries[i];

      if(subqueryPredicateFunction(subquery)) {

        const termResults = subquery.results;
        for(let j=0; j<termResults.length; j++) {
          const termResult = termResults[j];
          Object.keys(termResult).forEach(category => {
            Object.keys(termResult[category]).forEach(word => {
              const wordResult = termResult[category][word];
              for(const result of wordResult) {

                resultProcessFunction(result, word, category, subquery);

              }
            });
          });
        }
      }
    }

    postProcessFunction(this.subqueries);
    
  }

  combineSubqueryResults() {

    // Identify any excluded attributes - all we need here are their IDs for extremely quick/memory-efficient lookups
    let thereAreExcludedHits = false;
    this.run(`  Identify excluded results`, () => this.processSubqueryResults(
      (subquery) => !!subquery.excluded,
      (result) => {
        thereAreExcludedHits = true;
        this.excludedHits[result.id] = true;
      }
    ));

    // Identify any results included by mandatory search terms, and take the *intersection* of all mandatory search terms' results
    // The quick/cheap way to do this is to iterate over the results of all mandatory results, record which search terms contributed to each mandatory term, when check the number at the end to see if it equals the total number of mandatory search terms
    let numMandatorySubqueries = 0;
    const countPositiveResultsNotDeduped = this.subqueries.reduce((total, query) => total + (query.excluded ? 0 : query.count), 0);  // Count total number of results returned by any/all positive search terms; used for weighting
    this.run(`  Identify required results`, () => this.processSubqueryResults(
      (subquery) => {
        if(subquery.required) {
          numMandatorySubqueries++;
        }
        return !!subquery.required;
      },
      (result, word, category, subquery) => {
        if(!this.excludedHits[result.id]) {
          const existingResult = this.rankedResults[result.id];
          if(existingResult) {
            existingResult.required[subquery.input] = true;
            existingResult.weight = this.weightSearchResult(existingResult.weight, subquery, category, countPositiveResultsNotDeduped, result);  // The more results a search query returns, the less hits contribute to ranking as they're inherently less specific.  The more times a result contins the search term, the more it contributes.
          }
          else {
            const newResult = {
              required: {
                [subquery.input]: true
              },
              document: result.value,
              weight: 0
            };
            newResult.weight = this.weightSearchResult(newResult.weight, subquery, category, countPositiveResultsNotDeduped, result);
            this.rankedResults[result.id] = newResult;
          }
        }
      },
      () => {
        if(numMandatorySubqueries) {    // If there are any mandatory subqueries...
          for(let docId in this.rankedResults) { // Iterate over their results, and delete any results that have fewer results than there are mandatory subqueries (ie, if there are three mandatory subqueries, delete any results which are only included by two or fewer of them)
            if(Object.keys(this.rankedResults[docId].required).length < numMandatorySubqueries) {
              delete(this.rankedResults[docId]); // This looks sketchy as hell, deleting object keys in-place while iterating over them, but it is explicitly allowed by the spec: http://www.ecma-international.org/ecma-262/5.1/#sec-12.6.4
            }
          }
        }
      }
    ));


    // Time-saving optimisation here: if there are any mandatory search terms then by definition only documents in that list should be returned, so we're only iterating over the other subqueries in
    // order to determine how many other (non-mandatory) subqueries results from mandatory terms also occur in, so we know how to appropriately weight them for final search-results ordering.
    // Moreover, we've already partially counted their occurrences because any occurrences in mandatory subqueries have already been tallied by the code above... so to save time/memory we might as
    // well just add to the list we've already started building instead of duplicating it.

    // Conversely, if there are no mandatory search results then we're actually building and ranking a list of *all* search results, so we start with a empty list and add to it.

    // In either case, we can now ignore the results from required subqueries - in the former case because they've already been counted, and in the latter because there *are* none.

    // Run over all remaining non-required, non-excluded subquery results, and compiled a final ranked list of the number of occurrences of all qualifying results.
    this.run(`  Process remaining results`, () => this.processSubqueryResults(
      (subquery) => !subquery.required && !subquery.excluded,
      (result, word, category, subquery) => {
        const existingResult = this.rankedResults[result.id];
        if(numMandatorySubqueries && existingResult) { // There are mandatory subqueries and this result qualifies as one, so add one to its count
          existingResult.weight = this.weightSearchResult(existingResult.weight, subquery, category, countPositiveResultsNotDeduped, result);
        }
        else if (!numMandatorySubqueries && !this.excludedHits[result.id]) {  // There aren't any mandatory subqueries, and this result is not explicitly excluded by any exclude subqueries
          if(existingResult) {
            existingResult.weight = this.weightSearchResult(existingResult.weight, subquery, category, countPositiveResultsNotDeduped, result);
          }
          else {
            const newResult = {
              required: {
                [subquery.input]: false
              },
              document: result.value,
              weight: 0
            };
            newResult.weight = this.weightSearchResult(newResult.weight, subquery, category, countPositiveResultsNotDeduped, result);
            this.rankedResults[result.id] = newResult;
          }
        }
      }
    ));

  }

  sortResults() {
    return Object.values(this.rankedResults).sort((a,b) => b.weight - a.weight); // Sort in reverse order highest -> lowest
  }
}

module.exports = {
  StructuredSearchIndex,
  QueryResults,
  debugOutput,
  debugPassthrough
};