const ts = require('typescript');
const fs = require('fs');

const filePath = 'examples/st/test.js';
const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.ESNext, true);

ts.forEachChild(sourceFile, function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    const jsDoc = ts.getJSDocTags(node);
    console.log('Function:', node.name.text);
    console.log('  JSDoc tags count:', jsDoc.length);
    jsDoc.forEach(tag => {
      console.log('    Tag:', tag.tagName.text);
    });
  }
  ts.forEachChild(node, visit);
});
