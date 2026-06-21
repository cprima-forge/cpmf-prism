'use strict';

// Thin permanent wrapper — never reload this file.
// All logic lives in impl.js and is re-required fresh on every command call.

let _context;

function getImpl() {
    const implPath = require.resolve('./impl');
    delete require.cache[implPath];
    return require('./impl');
}

function activate(context) {
    _context = context;
    const vscode = require('vscode');

    const cmds = [
        'cpmf-uipath-spike.dump',
        'cpmf-uipath-spike.dumpCommands',
        'cpmf-uipath-spike.dumpInterop',
        'cpmf-uipath-spike.dumpProject',
        'cpmf-uipath-spike.getLicense',
        'cpmf-uipath-spike.showPanel',
    ];

    for (const cmd of cmds) {
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd, (...args) => getImpl().run(cmd, context, ...args))
        );
    }

    function makeProvider(viewId) {
        return {
            resolveWebviewView(webviewView) {
                webviewView.webview.options = { enableScripts: true };
                getImpl().resolveView(webviewView, context, viewId);
            }
        };
    }
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cpmf-uipath-spike.mainView', makeProvider('mainView')),
        vscode.window.registerWebviewViewProvider('cpmf-uipath-spike.sideView', makeProvider('sideView'))
    );
    vscode.window.showInformationMessage('CPMForge: Service Explorer Spike activated');

    // Auto-dump log on activation (background, no panel)
    setTimeout(() => getImpl().run('cpmf-uipath-spike.dump', context), 2000);
}

function deactivate() {}

module.exports = { activate, deactivate };
