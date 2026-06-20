const vscode = require('vscode');

function activate(context) {
  const cmd = vscode.commands.registerCommand('cpmf-prism-helloworld.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from CPMF Prism!');
  });
  context.subscriptions.push(cmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
