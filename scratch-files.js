const ts = require('typescript');
const path = require('path');
const tsconfigPath = path.resolve('examples/basic-ts/tsconfig.json');
const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
console.log(parsedConfig.fileNames);
