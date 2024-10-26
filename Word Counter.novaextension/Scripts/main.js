function debug(...args) {
    if (nova.workspace.config.get('com.gingerbeardman.Macro.debugLogs') !== true) {
        return; // Exit if debugging is not enabled
    }

    const processArg = (arg) => {
        if (typeof arg === 'object' && arg !== null) {
            return JSON.stringify(arg, null, 2);
        }
        return arg;
    };

    const processedArgs = args.map(processArg);
    console.log(...processedArgs);
}

class WordCounterDataProvider {
    static wordCounts = new Map();
    static disposables = [];
    
    constructor() {}
    
    getChildren() {
        debug("[Word Counter] getChildren called, counts:", Array.from(WordCounterDataProvider.wordCounts.entries()));
        
        // Convert Map entries to array and sort based on count (descending) and word (ascending)
        const sortedEntries = Array.from(WordCounterDataProvider.wordCounts.entries())
            .sort((a, b) => {
                // First sort by count in descending order
                const countDiff = b[1] - a[1];
                if (countDiff !== 0) return countDiff;
                
                // If counts are equal, sort alphabetically by word
                return a[0].localeCompare(b[0]);
            })
            .map(([word, count]) => ({
                word,
                count
            }));
            
        debug("[Word Counter] Sorted children:", sortedEntries);
        return sortedEntries;
    }
    
    getTreeItem(element) {
        let item = new TreeItem(element.word);
        
        // Get threshold values from workspace configuration
        const thresholdLow = nova.workspace.config.get("com.gingerbeardman.wordcounter.thresholdLow", "number") || 3;
        const thresholdMedium = nova.workspace.config.get("com.gingerbeardman.wordcounter.thresholdMedium", "number") || 7;
        const thresholdHigh = nova.workspace.config.get("com.gingerbeardman.wordcounter.thresholdHigh", "number") || 10;
        
        // Set icon and tooltip based on count thresholds
        if (element.count >= thresholdHigh) {
            item.image = "sidebar-list-child-high";
            item.tooltip = `${element.word}: ${element.count} occurrences (High Usage)`;
        } else if (element.count >= thresholdMedium) {
            item.image = "sidebar-list-child-med";
            item.tooltip = `${element.word}: ${element.count} occurrences (Medium Usage)`;
        } else if (element.count >= thresholdLow) {
            item.image = "sidebar-list-child-low";
            item.tooltip = `${element.word}: ${element.count} occurrences (Low Usage)`;
        } else {
            item.image = "sidebar-list-child-none";
            item.tooltip = `${element.word}: ${element.count} occurrences (Minimal Usage)`;
        }
        
        item.descriptiveText = String(element.count);
        item.identifier = element.word;
        item.collapsibleState = TreeItemCollapsibleState.None;
        
        return item;
    }
    
    static updateCounts(editor) {
        debug("[Word Counter] Updating counts for editor:", {
            path: editor?.document?.path,
            syntax: editor?.document?.syntax,
            isRemote: editor?.document?.isRemote,
            isUntitled: editor?.document?.isUntitled
        });
        
        if (!editor) {
            debug("[Word Counter] No editor provided, clearing counts");
            this.wordCounts.clear();
            return;
        }
        
        const text = editor.getTextInRange(new Range(0, editor.document.length));
        const trackedWords = nova.workspace.config.get("com.gingerbeardman.wordcounter.trackedWords", "array") || ["TODO", "FIX", "NOTE"];
        
        // Reset counts
        this.wordCounts.clear();
        trackedWords.forEach(word => {
            this.wordCounts.set(word, 0);
        });
        
        // Count occurrences
        trackedWords.forEach(word => {
            const regex = new RegExp(word, "g");
            const matches = text.match(regex);
            if (matches) {
                this.wordCounts.set(word, matches.length);
            }
        });
        
        debug("[Word Counter] New word counts:", Array.from(this.wordCounts.entries()));
    }
}

exports.activate = function() {
    debug("[Word Counter] Activating extension");
    
    let treeView = new TreeView("com.gingerbeardman.wordcounter.sidebar", {
        dataProvider: new WordCounterDataProvider()
    });
    
    // Watch for workspace config changes
    const configChangeDisposable = nova.workspace.config.onDidChange("com.gingerbeardman.wordcounter.trackedWords", (newVal, oldVal) => {
        debug("[Word Counter] Tracked words changed:", { newVal, oldVal });
        if (nova.workspace.activeTextEditor) {
            WordCounterDataProvider.updateCounts(nova.workspace.activeTextEditor);
            treeView.reload();
        }
    });
    nova.subscriptions.add(configChangeDisposable);

    const thresholdChangeDisposables = ["thresholdLow", "thresholdMedium", "thresholdHigh"].map(threshold => {
        const disposable = nova.workspace.config.onDidChange(`com.gingerbeardman.wordcounter.${threshold}`, () => {
            debug(`[Word Counter] ${threshold} changed`);
            if (nova.workspace.activeTextEditor) {
                WordCounterDataProvider.updateCounts(nova.workspace.activeTextEditor);
                treeView.reload();
            }
        });
        nova.subscriptions.add(disposable);
        return disposable;
    });

    function setupEditorMonitoring(editor) {
        if (!editor) return;

        debug("[Word Counter] Setting up monitoring for editor:", {
            path: editor.document?.path,
            syntax: editor.document?.syntax,
            isRemote: editor.document?.isRemote,
            isUntitled: editor.document?.isUntitled
        });

        // Watch for text changes
        const changeDisposable = editor.onDidStopChanging((editor) => {
            debug("[Word Counter] onDidStopChanging fired:", {
                path: editor.document?.path,
                isActive: editor === nova.workspace.activeTextEditor,
                isUntitled: editor.document?.isUntitled
            });
            
            if (editor.document.isUntitled) {
                debug("[Word Counter] Skipping untitled document");
                return;
            }

            if (editor === nova.workspace.activeTextEditor) {
                WordCounterDataProvider.updateCounts(editor);
                treeView.reload();
            } else {
                debug("[Word Counter] Skipping inactive editor");
            }
        });

        // Watch for text changes
        const pathDisposable = editor.document.onDidChangePath((editor) => {
            debug("[Word Counter] onDidChangePath fired:", {
                path: editor.document?.path,
                isActive: editor === nova.workspace.activeTextEditor,
                isUntitled: editor.document?.isUntitled
            });
            
            if (editor.document.isUntitled) {
                debug("[Word Counter] Skipping untitled document");
                return;
            }

            if (editor === nova.workspace.activeTextEditor) {
                WordCounterDataProvider.updateCounts(editor);
                treeView.reload();
            } else {
                debug("[Word Counter] Skipping inactive editor");
            }
        });

        // Watch for saves
        const saveDisposable = editor.onDidSave((editor) => {
            debug("[Word Counter] onDidSave fired:", {
                path: editor.document?.path,
                isActive: editor === nova.workspace.activeTextEditor
            });
            
            setTimeout(() => {
                if (editor === nova.workspace.activeTextEditor) {
                    WordCounterDataProvider.updateCounts(editor);
                    treeView.reload();
                } else {
                    debug("[Word Counter] Skipping inactive editor save");
                }
            }, 100);
        });

        // Store disposables
        WordCounterDataProvider.disposables.push(
            changeDisposable,
            saveDisposable
        );

        // Watch for editor destruction
        editor.onDidDestroy(() => {
            debug("[Word Counter] Editor destroyed:", {
                path: editor.document?.path
            });
        });
    }

    // Watch for new editors
    const editorDisposable = nova.workspace.onDidAddTextEditor((editor) => {
        debug("[Word Counter] onDidAddTextEditor fired:", {
            path: editor.document?.path,
            syntax: editor.document?.syntax,
            isActive: editor === nova.workspace.activeTextEditor
        });

        setupEditorMonitoring(editor);

        if (editor === nova.workspace.activeTextEditor) {
            WordCounterDataProvider.updateCounts(editor);
            treeView.reload();
        } else {
            debug("[Word Counter] Skipping inactive new editor");
        }
    });
    nova.subscriptions.add(editorDisposable);

    // Watch for document opens
    const documentDisposable = nova.workspace.onDidOpenTextDocument((document) => {
        debug("[Word Counter] onDidOpenTextDocument fired:", {
            path: document.path,
            syntax: document.syntax
        });
        
        const editor = nova.workspace.activeTextEditor;
        if (editor && editor.document === document) {
            WordCounterDataProvider.updateCounts(editor);
            treeView.reload();
        }
    });
    nova.subscriptions.add(documentDisposable);

    // Setup existing editors
    debug("[Word Counter] Setting up existing editors");
    nova.workspace.textEditors.forEach(editor => {
        setupEditorMonitoring(editor);
    });

    // Initial update for current editor
    const currentEditor = nova.workspace.activeTextEditor;
    debug("[Word Counter] Initial editor state:", {
        hasEditor: !!currentEditor,
        path: currentEditor?.document?.path,
        syntax: currentEditor?.document?.syntax
    });

    if (currentEditor) {
        WordCounterDataProvider.updateCounts(currentEditor);
        treeView.reload();
    }

    // Clean up when deactivated
    nova.subscriptions.add(treeView);
    
    debug("[Word Counter] Extension activated");
};