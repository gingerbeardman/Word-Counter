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
        const thresholdLow = nova.workspace.config.get("com.gingerbeardman.wordcounter.thresholdLow", "number") || 5;
        const thresholdMedium = nova.workspace.config.get("com.gingerbeardman.wordcounter.thresholdMedium", "number") || 10;
        const thresholdHigh = nova.workspace.config.get("com.gingerbeardman.wordcounter.thresholdHigh", "number") || 15;
        
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
        item.command = "com.gingerbeardman.wordcounter.doubleClick";
        item.contextValue = "wordItem";
        
        return item;
    }
    
    static async triggerSearch(word) {
        debug("[Word Counter] Triggering search for word:", word);
        
        // Construct the AppleScript command
        const appleScript = `
            tell application "System Events"
                keystroke "f" using command down
                delay 0.1
                keystroke "${word}"
            end tell
        `;
        
        // Execute the AppleScript command
        const process = new Process("/usr/bin/osascript", {
            args: ["-e", appleScript]
        });
        
        try {
            const result = await process.start();
            debug("[Word Counter] Search triggered successfully");
        } catch (error) {
            debug("[Word Counter] Error triggering search:", error);
            nova.workspace.showErrorMessage("Failed to trigger search: " + error.message);
        }
    }
    
    static handleDoubleClick() {
        if (!WordCounterDataProvider.treeView) {
            debug("[Word Counter] Tree view reference not found");
            return;
        }
        
        const selection = WordCounterDataProvider.treeView.selection;
        debug("[Word Counter] Selection:", selection);
        
        if (selection && selection[0]) {
            const selectedWord = selection[0].word;
            debug("[Word Counter] Selected word:", selectedWord);
            WordCounterDataProvider.triggerSearch(selectedWord);
        } else {
            debug("[Word Counter] No item selected");
        }
    }
    
    static handleAddWord(treeView) {
        debug("[Word Counter] Add word command triggered");
        
        const editor = nova.workspace.activeTextEditor;
        if (!editor) {
            nova.workspace.showWarningMessage("No active editor found. Please open a document first.");
            return;
        }
        
        const selectedRange = editor.selectedRange;
        let wordToAdd = null;
        
        // Check if there's selected text
        if (selectedRange && selectedRange.length > 0) {
            const selectedText = editor.getTextInRange(selectedRange).trim();
            if (selectedText) {
                wordToAdd = selectedText;
            }
        }
        
        // If no selected text, show input panel
        if (!wordToAdd) {
            nova.workspace.showInputPanel("Enter a word to track (tip: you can also select text in your document and click the + button to add it directly)", {
                label: "Word:",
                placeholder: "e.g., TODO, FIXME, NOTE",
                prompt: "Add Word"
            }, (inputValue) => {
                if (inputValue && inputValue.trim()) {
                    WordCounterDataProvider.addWordToTracking(inputValue.trim(), treeView);
                }
            });
            return;
        }
        
        // Add the selected word directly
        WordCounterDataProvider.addWordToTracking(wordToAdd, treeView);
    }
    
    static addWordToTracking(word, treeView) {
        debug("[Word Counter] Adding word to tracking:", word);
        
        // Get current tracked words
        const currentWords = nova.workspace.config.get("com.gingerbeardman.wordcounter.trackedWords", "array") || [];
        
        // Check if word is already being tracked
        if (currentWords.includes(word)) {
            return;
        }
        
        // Add the new word
        const updatedWords = [...currentWords, word];
        nova.workspace.config.set("com.gingerbeardman.wordcounter.trackedWords", updatedWords);
        
        debug("[Word Counter] Added word:", word);
        
        // Update counts and reload tree view
        const editor = nova.workspace.activeTextEditor;
        if (editor) {
            WordCounterDataProvider.updateCounts(editor);
            treeView.reload();
        }
    }
    
    static handleRemoveWord(treeView) {
        debug("[Word Counter] Remove word command triggered");
        
        if (!WordCounterDataProvider.treeView) {
            debug("[Word Counter] Tree view reference not found");
            return;
        }
        
        const selection = WordCounterDataProvider.treeView.selection;
        debug("[Word Counter] Selection for removal:", selection);
        
        if (!selection || !selection[0]) {
            nova.workspace.showWarningMessage("Please select a word to remove from tracking.");
            return;
        }
        
        const selectedWord = selection[0].word;
        debug("[Word Counter] Word to remove:", selectedWord);
        
        // Get current tracked words
        const currentWords = nova.workspace.config.get("com.gingerbeardman.wordcounter.trackedWords", "array") || [];
        
        // Remove the selected word
        const updatedWords = currentWords.filter(word => word !== selectedWord);
        
        if (updatedWords.length === currentWords.length) {
            return;
        }
        
        nova.workspace.config.set("com.gingerbeardman.wordcounter.trackedWords", updatedWords);
        
        debug("[Word Counter] Removed word:", selectedWord);
        
        // Update counts and reload tree view
        const editor = nova.workspace.activeTextEditor;
        if (editor) {
            WordCounterDataProvider.updateCounts(editor);
            treeView.reload();
        }
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
        const trackedWords = nova.workspace.config.get("com.gingerbeardman.wordcounter.trackedWords", "array") || ["TODO", "FIXME", "NOTE"];
        
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

    // Store reference to tree view
    WordCounterDataProvider.treeView = treeView;
    
    // Register the double-click command
    const doubleClickDisposable = nova.commands.register("com.gingerbeardman.wordcounter.doubleClick", () => {
        WordCounterDataProvider.handleDoubleClick();
    });
    nova.subscriptions.add(doubleClickDisposable);
    
    // Register the add word command
    const addWordDisposable = nova.commands.register("com.gingerbeardman.wordcounter.addWord", () => {
        WordCounterDataProvider.handleAddWord(treeView);
    });
    nova.subscriptions.add(addWordDisposable);
    
    // Register the remove word command
    const removeWordDisposable = nova.commands.register("com.gingerbeardman.wordcounter.removeWord", () => {
        WordCounterDataProvider.handleRemoveWord(treeView);
    });
    nova.subscriptions.add(removeWordDisposable);
    
    // Setup double-click behavior using mouse events
    const mouseDisposable = treeView.onDidChangeSelection((selection) => {
        if (treeView.onDidChangeSelection.clickCount === 2) {
            WordCounterDataProvider.handleDoubleClick();
        }
    });
    nova.subscriptions.add(mouseDisposable);

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

        // Watch for selection changes
        const selectionDisposable = editor.onDidChangeSelection((editor) => {
            debug("[Word Counter] onDidChangeSelection fired:", {
                path: editor.document?.path,
                isActive: editor === nova.workspace.activeTextEditor
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

        // Watch for text changes (as backup)
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
            selectionDisposable,
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