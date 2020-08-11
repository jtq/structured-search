# Simple Object Search Engine

A simple inverted-index search engine to index and store objects based on implementor-defined search terms.

For a collection of objects, choose which fields you index each object on and whether/how to tokenise each field.

Supports search queries involving wildcards, mandatory/excluded search terms and per-category searches, either using the built-in syntax using the parseQueryTerms() function, or define your own syntax and write your own function to turn intput strings into an array of structured SubQuery objects, then use it to perform queries on the engine.

## Usage

### Minimal example
```javascript
const { StructuredSearchIndex, QueryResults } = require('structured-search');
const mySearchIndex = new StructuredSearchIndex();
const someObject = { id:'uniqueid', name:'Title' };
mySearchIndex.addObject(someObject.name.toLowerCase(), someObject.id, someObject);
// Now we have a search index with one object in it, searchable by its name field, and uniquely identified by its id field (used for de-duplication, etc)

// Query the index:
mySearchIndex.query("title").forEach(result => console.log(result.weight, result.document));
```

### Simple example
```javascript
const { StructuredSearchIndex, QueryResults, parseQueryTerms } = require('structured-search');
const myLibrary = [       // Define a library of objects to index and object and store 
  { id:1, name:'Hugh' },
  { id:2, name:'Pugh' },
  { id:3, name:'Barney McGrew' },
  { id:4, name:'Cuthbert' },
  { id:1, name:'Dibble' },
  { id:1, name:'Grubb' }
];
const indexLibraryItem = (searchIndex, libraryItem) => {  // Tell the earch engine how to index an object
  searchIndex.addObject(libraryItem.id, libraryItem.id, libraryItem, null, 'identifier');
  libraryItem.name.toLowerCase().forEach(token => searchIndex.addObject(token, libraryItem.id, libraryItem, null, 'name'));
};
const mySearchIndex = new StructuredSearchIndex(myObjectLibrary, indexLibraryItem); // Construct a new index from the object library and indexing function

// Query the index:
mySearchIndex.query("identifier:3").forEach(result => console.log(result.weight, result.document)); // or
mySearchIndex.query("name:barney").forEach(result => console.log(result.weight, result.document));  // or
mySearchIndex.query("mcgrew").forEach(result => console.log(result.weight, result.document));
```

## Query syntax

The default provided search syntax is as provided (overrideable by injecting a replacement for `defaultParseQueryTermsFunction()` into the constructor parameters):

| Operator  | Name | Description | Example |
| --------- | ---- | ----------- | ------- |
| +         | Required | Only return results which include this term (other terms may still be used for weighting). | +Bob |
| -         | Excluded | Do not return results that match this term, even if they also match one or more required terms (excluded overrides required). | -Smith |
| category: | Category | Allows matching only within a specific 'category' or field (as defined when indexing objects). | lastname:Jones |

Operators may be combined as expected: `car +ford -model:fiesta`.


## Exploration of features / manual testing

This script may be used to query files full of JSON objects to test functionality of the library.

Currently the script is hard-coded to query the provided example library of JSON objects representing Magic: The Gathering cards for demonstration/test purposes, but this is easily changed/extended simply by implementing an alternative to `indexMTGCard(index, item)`.

### General syntax

`node explore "search query terms" [isCaseSensitive=true] [showDebugOutput=true] [objectsFile=./assets/21300-mtg-cards.json]`

Eg, to query the full sample file of 21300 JSON objects representing Magic: The Gathering cards in a cast-sensitive way with debug output:

`node explore "creature"`

To query the full sample file in a case-insensitive way with no debug output:

`node explore "creature" false false`

To query the debug library (only a handful of items) in a case-insensitive way with debug output:

`node explore "*" false true ./assets/debug-library.json`

All the usual query syntax operators, subquery-combining and the like work through explore.js.