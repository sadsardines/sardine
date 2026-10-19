// Global App State
var defaultCode = `# Welcome to Sardine!
show("--- Standard control flow demo ---")

cycle x = 0 : 5 {
    show("  Loop index =", x)
}
`;

var worker = null;
var virtualFiles = {
    'main.sad': defaultCode
};
var activeFilename = null;
var wasmReady = false;
var isRunning = false;

// Folders and System standard library state
var stdlibFiles = {};
var isStdlibExpanded = false;
var virtualFolders = [];
var expandedFolders = new Set();
var fileSortOrder = 'alphabetical'; // 'alphabetical', 'last-edited', or 'last-opened'
var virtualFileLastEdited = {
    'main.sad': Date.now()
};
var virtualFolderLastEdited = {};
var virtualFileLastOpened = {
    'main.sad': Date.now()
};
var virtualFolderLastOpened = {};

// D3 AST Interactive Explorer State Variables
var d3ZoomBehavior = null;
var d3Svg = null;
var d3G = null;
var dfsNodesQueue = [];
var currentTraversalIndex = -1;
var latestAst = null;
var d3NodeCoords = {};  // maps nodeId -> {x, y} in D3 tree coordinate space
window.eduEditorDecorations = [];
window.eduExecutionDecorations = [];

// Shared buffer communication variables
var sharedBuffer = null;
var sharedInt32 = null;
var sharedUint8 = null;

// Monaco Editor Instances
var editorInstance = null;
var eduEditorInstance = null;
window.isCursorSourcedFocus = false;

// Shared Constant
var TOKEN_LITERALS = {
    "PLUS": "+",
    "MINUS": "-",
    "MUL": "*",
    "DIV": "/",
    "MOD": "%",
    "FLOOR": "//",
    "EXP": "**",
    "EQUAL": "=",
    "PLUSEQUAL": "+=",
    "MINUSEQUAL": "-=",
    "MULEQUAL": "*=",
    "DIVIDEEQUAL": "/=",
    "MODULUSEQUAL": "%=",
    "FLOOREQUAL": "//=",
    "EXPEQUAL": "**=",
    "BITAND": "&",
    "BITANDEQUAL": "&=",
    "BITXOR": "^",
    "BITXOREQUAL": "^=",
    "BITOR": "|",
    "BITOREQUAL": "|=",
    "BITNOT": "~",
    "LSHIFT": "<<",
    "LSHIFTEQUAL": "<<=",
    "RSHIFT": ">>",
    "RSHIFTEQUAL": ">>=",
    "ARROW": "->",
    "LARROW": "<-",
    "NOTEQUAL": "!=",
    "DOUBLEEQUAL": "==",
    "LESSTHAN": "<",
    "GREATERTHAN": ">",
    "LESSERTHANEQUAL": "<=",
    "GREATERTHANEQUAL": ">=",
    "LPAREN": "(",
    "RPAREN": ")",
    "LPAREN2": "[",
    "RPAREN2": "]",
    "LPAREN3": "{",
    "RPAREN3": "}",
    "COLON": ":",
    "QUESTION": "?",
    "COMMA": ",",
    "DOT": ".",
    "NEWLINE": "\\n",
    "EOF": "EOF"
};

// Global Stub for selectFile (will be overwritten by editor.js)
window.selectFile = function(filename) {};

// Helper utilities
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// App Routing and State Configuration
const routes = {
    '#/': 'view-home',
    '#/docs': 'view-docs',
    '#/editor': 'view-editor',
    '#/educational': 'view-educational'
};

function handleRoute() {
    const rawHash = window.location.hash || '#/';
    // Match prefix matching (e.g. if we have arguments later)
    let matchedRoute = '#/';
    for (const route in routes) {
        if (rawHash.startsWith(route)) {
            matchedRoute = route;
        }
    }

    // Toggle views visibility
    document.querySelectorAll('.view-pane').forEach(el => el.classList.add('hidden'));
    const targetViewId = routes[matchedRoute];
    if (targetViewId) {
        document.getElementById(targetViewId).classList.remove('hidden');
    }

    // Update active navigation state
    document.querySelectorAll('nav a').forEach(el => {
        const href = el.getAttribute('href');
        if (href === matchedRoute) {
            el.className = "px-4 py-1.5 rounded-lg text-xs font-extrabold transition-all bg-indigo-500/15 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)] border border-indigo-500/30";
        } else {
            el.className = "px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:bg-slate-800/40 hover:text-slate-200 text-slate-400";
        }
    });

    // Trigger layout refresh for Monaco editor if it became visible
    if (matchedRoute === '#/editor' && editorInstance) {
        setTimeout(() => editorInstance.layout(), 50);
    }
    if (matchedRoute === '#/educational' && eduEditorInstance) {
        setTimeout(() => eduEditorInstance.layout(), 50);
    }
    if (matchedRoute === '#/docs' && typeof window.onDocsRouteActive === 'function') {
        window.onDocsRouteActive(rawHash);
    }
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    if (typeof updateSortButtonsUI === 'function') {
        updateSortButtonsUI();
    }
    handleRoute();
});

// Prompt user to create a new file
function createNewFilePrompt(isEdu = false, folderPath = null, event = null) {
    if (event) event.stopPropagation();

    // Check if there's already an active inline input box
    const existingInput = document.getElementById('new-file-inline-input');
    if (existingInput) {
        existingInput.focus();
        return;
    }

    // If folderPath is provided, ensure folder is expanded
    if (folderPath && !expandedFolders.has(folderPath)) {
        expandedFolders.add(folderPath);
        updateVirtualFilesUI();
    }

    let container;
    if (folderPath) {
        // Find the child container of the folder in the correct sidebar
        const sidebarId = isEdu ? 'edu-virtual-files-list' : 'virtual-files-list';
        const sidebar = document.getElementById(sidebarId);
        if (sidebar) {
            container = sidebar.querySelector(`[data-folder-path="${folderPath}"]`);
        }
    }
    if (!container) {
        container = document.getElementById(isEdu ? 'edu-virtual-files-list' : 'virtual-files-list');
    }

    // Remove the empty state message if it is showing
    if (!folderPath) {
        const emptyState = container.querySelector('.text-slate-600');
        if (emptyState) {
            container.innerHTML = "";
        }
    }

    // Create temporary list item
    const tempItem = document.createElement('div');
    tempItem.id = 'new-file-temp-item';
    tempItem.className = 'p-2.5 rounded-lg border bg-indigo-600/10 border-indigo-500/30 flex items-center text-xs transition-all';

    tempItem.innerHTML = `
        <div class="flex items-center space-x-2 w-full">
            <div class="icon-wrapper shrink-0">
                <i data-lucide="file-code" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>
            </div>
            <input type="text" id="new-file-inline-input" 
                class="bg-transparent border-none outline-none font-mono text-xs text-slate-200 flex-1 p-0 focus:ring-0 focus:outline-none placeholder-slate-500" 
                placeholder="filename.sad"
            />
        </div>
    `;

    container.appendChild(tempItem);
    lucide.createIcons();

    const input = document.getElementById('new-file-inline-input');
    input.focus();

    // Scroll sidebar container to the bottom so input is fully visible
    if (folderPath) {
        tempItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        container.scrollTop = container.scrollHeight;
    }

    let finished = false;

    function handleCancel() {
        if (finished) return;
        finished = true;
        tempItem.remove();
        if (Object.keys(virtualFiles).length === 0 && virtualFolders.length === 0) {
            updateVirtualFilesUI();
        }
    }

    function handleSubmit() {
        if (finished) return;
        let filename = input.value.trim();
        filename = filename.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!filename) {
            handleCancel();
            return;
        }

        // Prepend folderPath if creating in a folder
        const fullPath = folderPath ? (folderPath + '/' + filename) : filename;

        // Double check duplicate filenames
        if (virtualFiles[fullPath] !== undefined) {
            tempItem.classList.remove('animate-shake');
            void tempItem.offsetWidth; // trigger reflow to restart animation
            tempItem.classList.add('animate-shake');
            input.focus();
            return;
        }

        finished = true;
        virtualFiles[fullPath] = "";
        virtualFileLastEdited[fullPath] = Date.now();
        tempItem.remove();
        selectFile(fullPath);
    }

    // Bind keydown events (Enter to submit, Escape to cancel)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    });

    // Dynamically sanitize input & change icon/styles based on validity and file extension
    const iconWrapper = tempItem.querySelector('.icon-wrapper');
    input.addEventListener('input', () => {
        input.value = input.value.replace(/[<>:"\\|?*]/g, ''); // Allow / for nested paths
        input.value = input.value.replace(/\\/g, '/');
        const name = input.value.trim().replace(/^\/+|\/+$/g, '');
        const fullPath = folderPath ? (folderPath + '/' + name) : name;
        const isSad = name.endsWith('.sad');
        const isDuplicate = (virtualFiles[fullPath] !== undefined);

        if (isDuplicate) {
            tempItem.className = 'p-2.5 rounded-lg border bg-rose-950/20 border-rose-500/40 flex items-center text-xs transition-all';
            iconWrapper.innerHTML = `<i data-lucide="alert-circle" class="h-3.5 w-3.5 text-rose-400 shrink-0"></i>`;
        } else {
            tempItem.className = 'p-2.5 rounded-lg border bg-indigo-600/10 border-indigo-500/30 flex items-center text-xs transition-all';
            const iconName = isSad ? 'file-code' : 'file-text';
            const iconColor = isSad ? 'text-indigo-400' : 'text-slate-400';
            iconWrapper.innerHTML = `<i data-lucide="${iconName}" class="h-3.5 w-3.5 ${iconColor} shrink-0"></i>`;
        }
        lucide.createIcons();
    });

    // On blur, cancel the creation (delay slightly so click/keydown events process first)
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (finished) return;
            if (!document.getElementById('new-file-inline-input')) return;
            handleCancel();
        }, 150);
    });
}

// Download a folder as a ZIP file (including all subfolders recursively)
function downloadFolder(folderPath, event) {
    if (event) event.stopPropagation();

    if (typeof JSZip === 'undefined') {
        writeToTerminal("[Error] JSZip library is not loaded. Cannot download folder.", true);
        return;
    }

    const zip = new JSZip();
    const prefix = folderPath + '/';
    let filesAddedCount = 0;

    // Find all files that are inside this folder
    Object.keys(virtualFiles).forEach(filepath => {
        if (filepath.startsWith(prefix)) {
            // Get the relative path inside the zip
            const relativePath = filepath.substring(prefix.length);
            zip.file(relativePath, virtualFiles[filepath]);
            filesAddedCount++;
        }
    });

    // Also search for any subfolders that are empty and should be represented in the zip
    virtualFolders.forEach(subfolderPath => {
        if (subfolderPath === folderPath) return;
        if (subfolderPath.startsWith(prefix)) {
            const relativePath = subfolderPath.substring(prefix.length);
            zip.folder(relativePath);
            filesAddedCount++;
        }
    });

    if (filesAddedCount === 0) {
        // Keep the folder itself if it's completely empty
        zip.folder("");
    }

    // Get folder name for the zip filename
    const folderParts = folderPath.split('/');
    const folderName = folderParts[folderParts.length - 1] || 'folder';

    zip.generateAsync({ type: 'blob' }).then(content => {
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }).catch(err => {
        writeToTerminal("[Error] Failed to generate zip file: " + err.message, true);
    });
}

// Prompt user to create a new folder
function createNewFolderPrompt(isEdu = false) {
    const existingInput = document.getElementById('new-file-inline-input');
    if (existingInput) {
        existingInput.focus();
        return;
    }

    const container = document.getElementById(isEdu ? 'edu-virtual-files-list' : 'virtual-files-list');

    const emptyState = container.querySelector('.text-slate-600') || container.querySelector('.text-slate-500') || container.querySelector('.italic');
    if (emptyState && Object.keys(virtualFiles).length === 0 && virtualFolders.length === 0) {
        container.innerHTML = "";
    }

    const tempItem = document.createElement('div');
    tempItem.id = 'new-file-temp-item';
    tempItem.className = 'p-2.5 rounded-lg border bg-indigo-600/10 border-indigo-500/30 flex items-center text-xs transition-all';

    tempItem.innerHTML = `
        <div class="flex items-center space-x-2 w-full">
            <div class="icon-wrapper shrink-0">
                <i data-lucide="folder-plus" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>
            </div>
            <input type="text" id="new-file-inline-input"
                class="bg-transparent border-none outline-none font-mono text-xs text-slate-200 flex-1 p-0 focus:ring-0 focus:outline-none placeholder-slate-500"
                placeholder="folder_name"
            />
        </div>
    `;

    container.appendChild(tempItem);
    lucide.createIcons();

    const input = document.getElementById('new-file-inline-input');
    input.focus();
    container.scrollTop = container.scrollHeight;

    let finished = false;

    function handleCancel() {
        if (finished) return;
        finished = true;
        tempItem.remove();
        if (Object.keys(virtualFiles).length === 0 && virtualFolders.length === 0) {
            updateVirtualFilesUI();
        }
    }

    function handleSubmit() {
        if (finished) return;
        let foldername = input.value.trim();
        foldername = foldername.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!foldername) {
            handleCancel();
            return;
        }

        if (virtualFolders.includes(foldername)) {
            tempItem.classList.remove('animate-shake');
            void tempItem.offsetWidth;
            tempItem.classList.add('animate-shake');
            input.focus();
            return;
        }

        finished = true;
        virtualFolders.push(foldername);
        virtualFolderLastEdited[foldername] = Date.now();
        tempItem.remove();
        updateVirtualFilesUI();
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    });

    const iconWrapper = tempItem.querySelector('.icon-wrapper');
    input.addEventListener('input', () => {
        input.value = input.value.replace(/[<>:"\\|?*]/g, '');
        input.value = input.value.replace(/\\/g, '/');
        const name = input.value.trim().replace(/^\/+|\/+$/g, '');
        const isDuplicate = virtualFolders.includes(name);

        if (isDuplicate) {
            tempItem.className = 'p-2.5 rounded-lg border bg-rose-950/20 border-rose-500/40 flex items-center text-xs transition-all';
            iconWrapper.innerHTML = `<i data-lucide="alert-circle" class="h-3.5 w-3.5 text-rose-400 shrink-0"></i>`;
        } else {
            tempItem.className = 'p-2.5 rounded-lg border bg-indigo-600/10 border-indigo-500/30 flex items-center text-xs transition-all';
            iconWrapper.innerHTML = `<i data-lucide="folder-plus" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>`;
        }
        lucide.createIcons();
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (finished) return;
            if (!document.getElementById('new-file-inline-input')) return;
            handleCancel();
        }, 150);
    });
}

var fileToDelete = null;

// Delete an individual file (custom in-browser modal)
function deleteFile(filename, event) {
    if (event) event.stopPropagation(); // Prevent choosing the file
    fileToDelete = filename;

    const modal = document.getElementById('delete-confirm-modal');
    const span = document.getElementById('delete-modal-filename');
    if (modal && span) {
        span.innerText = filename;
        modal.classList.remove('hidden');
    }
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    fileToDelete = null;
}

function confirmDeleteFile() {
    if (!fileToDelete) return;
    const name = fileToDelete;

    // Check if it's a folder
    const isFolder = virtualFolders.includes(name);
    if (isFolder) {
        // Delete this folder and all subfolders from virtualFolders list
        virtualFolders = virtualFolders.filter(f => f !== name && !f.startsWith(name + '/'));
        delete virtualFolderLastEdited[name];
        delete virtualFolderLastOpened[name];
        Object.keys(virtualFolderLastEdited).forEach(f => {
            if (f.startsWith(name + '/')) {
                delete virtualFolderLastEdited[f];
            }
        });
        Object.keys(virtualFolderLastOpened).forEach(f => {
            if (f.startsWith(name + '/')) {
                delete virtualFolderLastOpened[f];
            }
        });

        // Delete all files inside this folder from virtualFiles
        const prefix = name + '/';
        Object.keys(virtualFiles).forEach(file => {
            if (file.startsWith(prefix)) {
                delete virtualFiles[file];
                delete virtualFileLastEdited[file];
                delete virtualFileLastOpened[file];
            }
        });
    } else {
        delete virtualFiles[name];
        delete virtualFileLastEdited[name];
        delete virtualFileLastOpened[name];
    }

    if (activeFilename && (activeFilename === name || activeFilename.startsWith(name + '/'))) {
        const keys = Object.keys(virtualFiles);
        selectFile(keys.length > 0 ? keys[0] : null);
    } else {
        updateVirtualFilesUI();
    }

    closeDeleteModal();
}

// Download an individual file
function downloadFile(filename, event) {
    if (event) event.stopPropagation(); // Prevent choosing the file
    if (virtualFolders.includes(filename)) return; // Folders cannot be downloaded directly
    if (virtualFiles[filename] === undefined) return;

    const blob = new Blob([virtualFiles[filename]], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const parts = filename.split('/');
    const basename = parts[parts.length - 1];
    a.download = basename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function updateVirtualFilesUI() {
    const containers = [
        document.getElementById('virtual-files-list'),
        document.getElementById('edu-virtual-files-list')
    ];

    // 1. Build directory tree from virtualFiles and virtualFolders list
    function buildTree() {
        let root = { files: [], folders: {} };

        // Add empty folders from virtualFolders
        virtualFolders.forEach(folderPath => {
            let parts = folderPath.split('/').filter(p => p);
            let current = root;
            let currentPath = "";
            parts.forEach(part => {
                currentPath = currentPath ? (currentPath + '/' + part) : part;
                if (!current.folders[part]) {
                    current.folders[part] = { name: part, path: currentPath, files: [], folders: {} };
                }
                current = current.folders[part];
            });
        });

        // Add files from virtualFiles
        Object.keys(virtualFiles).forEach(filepath => {
            let parts = filepath.split('/');
            let current = root;
            let currentPath = "";
            for (let i = 0; i < parts.length - 1; i++) {
                let part = parts[i];
                currentPath = currentPath ? (currentPath + '/' + part) : part;
                if (!current.folders[part]) {
                    current.folders[part] = { name: part, path: currentPath, files: [], folders: {} };
                }
                current = current.folders[part];
            }
            current.files.push({
                name: parts[parts.length - 1],
                path: filepath
            });
        });

        return root;
    }

    const treeRoot = buildTree();

    // Helpers for rendering tree nodes recursively
    function renderFileItem(parentEl, displayName, path, depth, isSystemFile) {
        const isSad = displayName.endsWith('.sad');
        const isActive = (path === activeFilename);
        const item = document.createElement('div');

        const activeClass = 'bg-gradient-to-r from-indigo-500/15 via-purple-500/10 to-indigo-500/5 border-indigo-500/50 translate-x-1';
        const inactiveClass = 'bg-slate-900/40 border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-950/60 hover:translate-x-1';

        item.className = `p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition-all duration-300 group ${isActive ? activeClass : inactiveClass}`;
        item.setAttribute('onclick', `selectFile("${path}")`);

        const iconName = isSad ? 'file-code' : 'file-text';
        const iconColor = isSad ? 'text-indigo-400' : 'text-slate-400';
        const nameColor = isActive ? 'text-white font-bold' : 'text-slate-400 group-hover:text-slate-200';
        const btnOpacityClass = isActive ? 'opacity-80 hover:opacity-100' : 'opacity-0 group-hover:opacity-100';

        let actionButtons = '';
        if (!isSystemFile) {
            actionButtons = `
                <div class="flex items-center space-x-1 ${btnOpacityClass} transition-opacity duration-200">
                    <button onclick="downloadFile('${path}', event)" class="p-1 text-slate-400 hover:text-sky-400 hover:drop-shadow-[0_0_4px_rgba(56,189,248,0.65)]" title="Download">
                        <i data-lucide="download" class="h-3.5 w-3.5"></i>
                    </button>
                    <button onclick="deleteFile('${path}', event)" class="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-850 rounded" title="Delete">
                        <i data-lucide="trash-2" class="h-3.5 w-3.5"></i>
                    </button>
                </div>
            `;
        } else {
            actionButtons = `
                <div class="flex items-center space-x-1">
                    <span class="text-[7px] font-bold text-slate-500 uppercase tracking-wider select-none shrink-0 border border-slate-800 bg-slate-950 px-1 py-0.5 rounded">READ ONLY</span>
                </div>
            `;
        }

        item.innerHTML = `
            <div class="flex items-center space-x-2 truncate flex-1 mr-2">
                <i data-lucide="${iconName}" class="h-3.5 w-3.5 ${iconColor} shrink-0"></i>
                <span class="font-mono ${nameColor} truncate">${displayName}</span>
            </div>
            ${actionButtons}
        `;
        parentEl.appendChild(item);
    }

    function renderUserFolder(parentEl, folderNode, depth) {
        const folderItem = document.createElement('div');
        const isExpanded = expandedFolders.has(folderNode.path);
        const inactiveClass = 'bg-slate-900/40 border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-950/60';

        folderItem.className = `p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition-all duration-300 group ${inactiveClass}`;

        folderItem.onclick = (e) => {
            e.stopPropagation();
            if (isExpanded) {
                expandedFolders.delete(folderNode.path);
            } else {
                expandedFolders.add(folderNode.path);
                if (typeof virtualFolderLastOpened !== 'undefined') {
                    virtualFolderLastOpened[folderNode.path] = Date.now();
                }
            }
            updateVirtualFilesUI();
        };

        const chevronIcon = isExpanded ? 'chevron-down' : 'chevron-right';
        const isEdu = !!(parentEl.id === 'edu-virtual-files-list' || parentEl.closest('#edu-virtual-files-list'));

        folderItem.innerHTML = `
            <div class="flex items-center space-x-2 truncate flex-1 mr-2">
                <i data-lucide="${chevronIcon}" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>
                <i data-lucide="folder" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>
                <span class="font-mono text-slate-400 group-hover:text-slate-200 truncate font-semibold">${folderNode.name}</span>
            </div>
            <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <button onclick="createNewFilePrompt(${isEdu}, '${folderNode.path}', event)" class="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-850 rounded hover:shadow-[0_0_8px_rgba(52,211,153,0.35)]" title="New File in Folder">
                    <i data-lucide="plus" class="h-3.5 w-3.5"></i>
                </button>
                <button onclick="downloadFolder('${folderNode.path}', event)" class="p-1 text-slate-400 hover:text-sky-400 hover:drop-shadow-[0_0_4px_rgba(56,189,248,0.65)]" title="Download Folder">
                    <i data-lucide="download" class="h-3.5 w-3.5"></i>
                </button>
                <button onclick="deleteFile('${folderNode.path}', event)" class="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-850 rounded" title="Delete Folder">
                    <i data-lucide="trash-2" class="h-3.5 w-3.5"></i>
                </button>
            </div>
        `;
        parentEl.appendChild(folderItem);

        if (isExpanded) {
            const childContainer = document.createElement('div');
            childContainer.dataset.folderPath = folderNode.path;
            childContainer.className = "flex flex-col space-y-1.5 mt-1.5 ml-2 border-l border-slate-800/80 pl-2";
            renderNode(childContainer, folderNode, depth + 1);
            parentEl.appendChild(childContainer);
        }
    }

    function renderSystemFolder(parentEl, name, path, isExpanded, onToggle, onRenderChildren) {
        const folderItem = document.createElement('div');
        const inactiveClass = 'bg-slate-900/40 border-slate-800/80 hover:border-indigo-500/40 hover:bg-slate-950/60';
        folderItem.className = `p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition-all duration-300 group ${inactiveClass}`;

        folderItem.onclick = (e) => {
            e.stopPropagation();
            onToggle(!isExpanded);
        };

        const chevronIcon = isExpanded ? 'chevron-down' : 'chevron-right';

        folderItem.innerHTML = `
            <div class="flex items-center space-x-2 truncate flex-1 mr-2">
                <i data-lucide="${chevronIcon}" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>
                <i data-lucide="folder-git" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>
                <span class="font-mono text-slate-400 group-hover:text-slate-200 truncate font-semibold uppercase tracking-wider text-[10px]">${name}</span>
            </div>
            <div>
                <span class="text-[8px] font-black uppercase text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-500/30 font-sans tracking-wide leading-none select-none shrink-0">SYSTEM</span>
            </div>
        `;
        parentEl.appendChild(folderItem);

        if (isExpanded) {
            const childContainer = document.createElement('div');
            childContainer.className = "flex flex-col space-y-1.5 mt-1.5 ml-2 border-l border-slate-800/80 pl-2";
            onRenderChildren(childContainer);
            parentEl.appendChild(childContainer);
        }
    }

    function getFolderLastEdited(folderNode) {
        let maxTime = virtualFolderLastEdited[folderNode.path] || 0;
        folderNode.files.forEach(file => {
            maxTime = Math.max(maxTime, virtualFileLastEdited[file.path] || 0);
        });
        Object.keys(folderNode.folders).forEach(key => {
            maxTime = Math.max(maxTime, getFolderLastEdited(folderNode.folders[key]));
        });
        return maxTime;
    }

    function getFolderLastOpened(folderNode) {
        let maxTime = virtualFolderLastOpened[folderNode.path] || 0;
        folderNode.files.forEach(file => {
            maxTime = Math.max(maxTime, virtualFileLastOpened[file.path] || 0);
        });
        Object.keys(folderNode.folders).forEach(key => {
            maxTime = Math.max(maxTime, getFolderLastOpened(folderNode.folders[key]));
        });
        return maxTime;
    }

    function renderNode(parentEl, node, depth) {
        // 1. Render subfolders
        const folderKeys = Object.keys(node.folders);
        if (fileSortOrder === 'last-edited') {
            folderKeys.sort((a, b) => {
                const timeA = getFolderLastEdited(node.folders[a]);
                const timeB = getFolderLastEdited(node.folders[b]);
                if (timeB !== timeA) {
                    return timeB - timeA;
                }
                return a.localeCompare(b);
            });
        } else if (fileSortOrder === 'last-opened') {
            folderKeys.sort((a, b) => {
                const timeA = getFolderLastOpened(node.folders[a]);
                const timeB = getFolderLastOpened(node.folders[b]);
                if (timeB !== timeA) {
                    return timeB - timeA;
                }
                return a.localeCompare(b);
            });
        } else {
            folderKeys.sort();
        }
        folderKeys.forEach(key => {
            renderUserFolder(parentEl, node.folders[key], depth);
        });

        // 2. Render files
        if (fileSortOrder === 'last-edited') {
            node.files.sort((a, b) => {
                const timeA = virtualFileLastEdited[a.path] || 0;
                const timeB = virtualFileLastEdited[b.path] || 0;
                if (timeB !== timeA) {
                    return timeB - timeA;
                }
                return a.name.localeCompare(b.name);
            });
        } else if (fileSortOrder === 'last-opened') {
            node.files.sort((a, b) => {
                const timeA = virtualFileLastOpened[a.path] || 0;
                const timeB = virtualFileLastOpened[b.path] || 0;
                if (timeB !== timeA) {
                    return timeB - timeA;
                }
                return a.name.localeCompare(b.name);
            });
        } else {
            node.files.sort((a, b) => a.name.localeCompare(b.name));
        }
        node.files.forEach(file => {
            renderFileItem(parentEl, file.name, file.path, depth, false);
        });
    }

    containers.forEach(container => {
        if (!container) return;
        container.innerHTML = "";

        // 2. Render /stdlib System Folder
        const stdlibKeys = Object.keys(stdlibFiles);
        if (stdlibKeys.length > 0) {
            renderSystemFolder(container, "stdlib", "stdlib", isStdlibExpanded, (expand) => {
                isStdlibExpanded = expand;
                updateVirtualFilesUI();
            }, (childContainer) => {
                stdlibKeys.sort().forEach(name => {
                    renderFileItem(childContainer, name, "stdlib/" + name, 1, true);
                });
            });
        }

        // 3. Render user directories
        renderNode(container, treeRoot, 0);

        if (container.children.length === 0) {
            container.innerHTML = `
                <div class="text-slate-500 italic p-6 text-center border border-dashed border-slate-800/60 rounded-xl flex flex-col items-center justify-center space-y-2 bg-slate-950/20 backdrop-blur-sm">
                    <i data-lucide="archive" class="h-6 w-6 text-slate-600 animate-pulse"></i>
                    <div class="flex flex-col space-y-0.5">
                        <p class="text-xs font-bold text-slate-400 font-sans tracking-wide">NO FILES</p>
                        <p class="text-[10px] text-slate-500 font-sans">Summon a file to begin your quest.</p>
                    </div>
                </div>
            `;
        }
    });
    lucide.createIcons();
}

function clearVirtualFiles() {
    virtualFiles = {};
    virtualFolders = [];
    virtualFileLastEdited = {};
    virtualFolderLastEdited = {};
    virtualFileLastOpened = {};
    virtualFolderLastOpened = {};
    selectFile(null);
    writeToTerminal("// Sandbox filesystem cleared.");
}

function updateSortButtonsUI() {
    const btnIds = ['btn-sort-toggle', 'edu-btn-sort-toggle'];
    btnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        
        if (fileSortOrder === 'alphabetical') {
            btn.title = 'Sort: Alphabetical Order (Click to sort by Last Edited)';
            btn.className = 'p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-900 rounded transition-all cursor-pointer active:scale-90';
        } else if (fileSortOrder === 'last-edited') {
            btn.title = 'Sort: Last Edited first (Click to sort by Last Opened)';
            btn.className = 'p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-slate-900 rounded transition-all cursor-pointer active:scale-90';
        } else {
            btn.title = 'Sort: Last Opened first (Click to sort Alphabetically)';
            btn.className = 'p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 rounded transition-all cursor-pointer active:scale-90';
        }
    });
}

function toggleFileSorting() {
    if (fileSortOrder === 'alphabetical') {
        fileSortOrder = 'last-edited';
    } else if (fileSortOrder === 'last-edited') {
        fileSortOrder = 'last-opened';
    } else {
        fileSortOrder = 'alphabetical';
    }
    
    updateSortButtonsUI();
    updateVirtualFilesUI();
}

// Pop-up File Viewer details
var fileViewerEditor = null;

function openVirtualFile(filename) {
    if (virtualFiles[filename] === undefined) return;

    document.getElementById('modal-file-name').innerText = filename;
    document.getElementById('file-viewer-modal').classList.remove('hidden');

    // Initialize modal's read-only monaco container
    setTimeout(() => {
        const container = document.getElementById('file-monaco-container');
        if (!fileViewerEditor) {
            fileViewerEditor = monaco.editor.create(container, {
                value: virtualFiles[filename],
                language: 'plaintext',
                theme: 'sardine-dark',
                readOnly: true,
                minimap: { enabled: false },
                automaticLayout: true,
                fontFamily: 'Consolas, "Courier New", Courier, monospace'
            });
        } else {
            fileViewerEditor.setValue(virtualFiles[filename]);
        }
    }, 50);
}

function closeFileViewer() {
    document.getElementById('file-viewer-modal').classList.add('hidden');
}

// Toggle Virtual Files Sidebar (collapsible)
function toggleSidebar(isEdu = false) {
    const sidebar = document.getElementById(isEdu ? 'edu-sidebar' : 'editor-sidebar');
    const expanded = document.getElementById(isEdu ? 'edu-sidebar-expanded-content' : 'sidebar-expanded-content');
    const collapsed = document.getElementById(isEdu ? 'edu-sidebar-collapsed-content' : 'sidebar-collapsed-content');

    if (!sidebar || !expanded || !collapsed) return;

    if (sidebar.classList.contains('w-72')) {
        // Collapse into narrow bar
        sidebar.classList.remove('w-72');
        sidebar.classList.add('w-14');
        expanded.classList.add('hidden');
        collapsed.classList.remove('hidden');
    } else {
        // Expand back to normal width
        sidebar.classList.remove('w-14');
        sidebar.classList.add('w-72');
        expanded.classList.remove('hidden');
        collapsed.classList.add('hidden');
    }

    // Update Monaco Editor layout dynamically to fit the new width
    const currentEditor = isEdu ? eduEditorInstance : editorInstance;
    if (currentEditor) {
        setTimeout(() => currentEditor.layout(), 350); // allow sidebar transition to finish
    }
}

function changeFontSize(size) {
    const sizeNum = parseInt(size);
    if (editorInstance) {
        editorInstance.updateOptions({ fontSize: sizeNum, lineHeight: Math.round(sizeNum * 1.5) });
    }
    if (eduEditorInstance) {
        eduEditorInstance.updateOptions({ fontSize: sizeNum, lineHeight: Math.round(sizeNum * 1.5) });
    }
    // Sync drop-down selectors
    const sel1 = document.getElementById('editor-font-size-select');
    const sel2 = document.getElementById('edu-editor-font-size-select');
    if (sel1 && sel1.value !== size) sel1.value = size;
    if (sel2 && sel2.value !== size) sel2.value = size;
}

// Collapsable Terminal Controller
var terminalHeights = { regular: 288, edu: 288 };
var terminalCollapsed = { regular: false, edu: false };

function toggleTerminal(isEdu = false) {
    const key = isEdu ? 'edu' : 'regular';
    const terminal = document.getElementById(isEdu ? 'edu-terminal-section' : 'terminal-section');
    const consoleEl = document.getElementById(isEdu ? 'edu-terminal-console' : 'terminal-console');
    const inputRow = document.getElementById(isEdu ? 'edu-terminal-input-row' : 'terminal-input-row');
    const resizeHandle = document.getElementById(isEdu ? 'edu-terminal-resize-handle' : 'terminal-resize-handle');
    const toggleBtn = document.getElementById(isEdu ? 'edu-terminal-toggle-btn' : 'terminal-toggle-btn');

    if (!terminal) return;

    if (!terminalCollapsed[key]) {
        // Collapse terminal
        terminalHeights[key] = terminal.offsetHeight;
        terminal.style.height = '44px'; // Header height only
        if (consoleEl) consoleEl.classList.add('hidden');
        if (inputRow) inputRow.classList.add('hidden');
        if (resizeHandle) resizeHandle.style.display = 'none';
        terminalCollapsed[key] = true;

        if (toggleBtn) {
            toggleBtn.innerHTML = `<i data-lucide="chevron-up" class="h-4 w-4"></i>`;
            lucide.createIcons();
        }
    } else {
        // Expand terminal
        terminal.style.height = `${terminalHeights[key]}px`;
        if (consoleEl) consoleEl.classList.remove('hidden');
        if (resizeHandle) resizeHandle.style.display = 'block';
        terminalCollapsed[key] = false;

        if (toggleBtn) {
            toggleBtn.innerHTML = `<i data-lucide="chevron-down" class="h-4 w-4"></i>`;
            lucide.createIcons();
        }
    }

    // Recalculate editor geometry
    const currentEditor = isEdu ? eduEditorInstance : editorInstance;
    if (currentEditor) {
        setTimeout(() => currentEditor.layout(), 50);
    }
}

function collapseSidebar(isEdu = false) {
    const sidebar = document.getElementById(isEdu ? 'edu-sidebar' : 'editor-sidebar');
    const expanded = document.getElementById(isEdu ? 'edu-sidebar-expanded-content' : 'sidebar-expanded-content');
    const collapsed = document.getElementById(isEdu ? 'edu-sidebar-collapsed-content' : 'sidebar-collapsed-content');

    if (!sidebar || !expanded || !collapsed) return;

    if (sidebar.classList.contains('w-72')) {
        sidebar.classList.remove('w-72');
        sidebar.classList.add('w-14');
        expanded.classList.add('hidden');
        collapsed.classList.remove('hidden');

        const currentEditor = isEdu ? eduEditorInstance : editorInstance;
        if (currentEditor) {
            setTimeout(() => currentEditor.layout(), 350);
        }
    }
}

function collapseTerminal(isEdu = false) {
    const key = isEdu ? 'edu' : 'regular';
    const terminal = document.getElementById(isEdu ? 'edu-terminal-section' : 'terminal-section');
    const consoleEl = document.getElementById(isEdu ? 'edu-terminal-console' : 'terminal-console');
    const inputRow = document.getElementById(isEdu ? 'edu-terminal-input-row' : 'terminal-input-row');
    const resizeHandle = document.getElementById(isEdu ? 'edu-terminal-resize-handle' : 'terminal-resize-handle');
    const toggleBtn = document.getElementById(isEdu ? 'edu-terminal-toggle-btn' : 'terminal-toggle-btn');

    if (!terminal) return;

    if (!terminalCollapsed[key]) {
        terminalHeights[key] = terminal.offsetHeight;
        terminal.style.height = '44px'; // Header height only
        if (consoleEl) consoleEl.classList.add('hidden');
        if (inputRow) inputRow.classList.add('hidden');
        if (resizeHandle) resizeHandle.style.display = 'none';
        terminalCollapsed[key] = true;

        if (toggleBtn) {
            toggleBtn.innerHTML = `<i data-lucide="chevron-up" class="h-4 w-4"></i>`;
            lucide.createIcons();
        }

        const currentEditor = isEdu ? eduEditorInstance : editorInstance;
        if (currentEditor) {
            setTimeout(() => currentEditor.layout(), 50);
        }
    }
}


// Adjustable Terminal Height
function initTerminalResizer() {
    const handle = document.getElementById('terminal-resize-handle');
    const terminal = document.getElementById('terminal-section');
    if (!handle || !terminal) return;

    let startY = 0;
    let startHeight = 0;

    function onMouseDown(e) {
        e.preventDefault();
        startY = e.clientY;
        startHeight = terminal.offsetHeight;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        document.body.classList.add('cursor-ns-resize', 'select-none');
    }

    function onMouseMove(e) {
        const deltaY = e.clientY - startY;
        let newHeight = startHeight - deltaY;

        // Constraints (min 60px, max 75% window height)
        const minHeight = 60;
        const maxHeight = window.innerHeight * 0.75;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;

        terminal.style.height = `${newHeight}px`;
        terminalHeights.regular = newHeight; // Store dragged height

        // Update Monaco geometry in real time
        if (editorInstance) {
            editorInstance.layout();
        }
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.classList.remove('cursor-ns-resize', 'select-none');

        if (editorInstance) {
            editorInstance.layout();
        }
    }

    handle.addEventListener('mousedown', onMouseDown);
}

// Adjustable Educational Terminal Height
function initEduTerminalResizer() {
    const handle = document.getElementById('edu-terminal-resize-handle');
    const terminal = document.getElementById('edu-terminal-section');
    if (!handle || !terminal) return;

    let startY = 0;
    let startHeight = 0;

    function onMouseDown(e) {
        e.preventDefault();
        startY = e.clientY;
        startHeight = terminal.offsetHeight;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        document.body.classList.add('cursor-ns-resize', 'select-none');
    }

    function onMouseMove(e) {
        const deltaY = e.clientY - startY;
        let newHeight = startHeight - deltaY;

        // Constraints (min 60px, max 75% window height)
        const minHeight = 60;
        const maxHeight = window.innerHeight * 0.75;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;

        terminal.style.height = `${newHeight}px`;
        terminalHeights.edu = newHeight; // Store dragged height

        // Update Monaco geometry in real time
        if (eduEditorInstance) {
            eduEditorInstance.layout();
        }
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.classList.remove('cursor-ns-resize', 'select-none');

        if (eduEditorInstance) {
            eduEditorInstance.layout();
        }
    }

    handle.addEventListener('mousedown', onMouseDown);
}

// Adjustable Educational Info Sidebar Width
function initEduSidebarResizer() {
    const handle = document.getElementById('edu-right-sidebar-resize-handle');
    const sidebar = document.getElementById('edu-info-sidebar');
    if (!handle || !sidebar) return;

    let startX = 0;
    let startWidth = 0;

    function onMouseDown(e) {
        e.preventDefault();
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        document.body.classList.add('cursor-col-resize', 'select-none');
    }

    function onMouseMove(e) {
        const deltaX = startX - e.clientX; // drag left to increase width of right sidebar
        let newWidth = startWidth + deltaX;

        // Constraints (min width based on stepper active state, max 60% window width)
        const stepperPanel = document.getElementById('edu-stepper-panel');
        const isStepperActive = stepperPanel && !stepperPanel.classList.contains('hidden');
        const minWidth = isStepperActive ? 520 : 200;
        const maxWidth = window.innerWidth * 0.6;
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;

        sidebar.style.width = `${newWidth}px`;

        // Update Monaco geometry in real time
        if (eduEditorInstance) {
            eduEditorInstance.layout();
        }
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.classList.remove('cursor-col-resize', 'select-none');

        if (eduEditorInstance) {
            eduEditorInstance.layout();
        }
    }

    handle.addEventListener('mousedown', onMouseDown);
}

function switchEduTab(tabName) {
    const tokensBtn = document.getElementById('edu-tab-tokens');
    const astBtn = document.getElementById('edu-tab-ast');
    const tokensPanel = document.getElementById('edu-tokens-panel');
    const astPanel = document.getElementById('edu-ast-panel');

    if (tabName === 'tokens') {
        tokensBtn.className = "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-white bg-indigo-600/20 text-indigo-400 border border-indigo-500/10";
        astBtn.className = "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-slate-400 hover:text-slate-200";
        tokensPanel.classList.remove('hidden');
        astPanel.classList.add('hidden');
    } else {
        astBtn.className = "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-white bg-indigo-600/20 text-indigo-400 border border-indigo-500/10";
        tokensBtn.className = "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all text-slate-400 hover:text-slate-200";
        astPanel.classList.remove('hidden');
        tokensPanel.classList.add('hidden');

        // Re-render AST Tree now that the container is visible and size can be resolved
        if (latestAst) {
            renderAstTree(latestAst);
        }
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('page-loading-overlay');
    if (overlay) {
        overlay.classList.add('opacity-0');
        // Remove from DOM to prevent pointer/keyboard events blocking
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 500);
    }
}

// Trigger worker startup
window.addEventListener('load', () => {
    initWasmWorker();
    updateVirtualFilesUI();
    initTerminalResizer();
    initEduTerminalResizer();
    initEduSidebarResizer();

    // Fail-safe: hide overlay after 3 seconds if Monaco/worker loads too slow
    setTimeout(hideLoadingOverlay, 3000);

    // Set up custom delete confirmation modal handlers
    const cancelBtn = document.getElementById('delete-modal-btn-cancel');
    const confirmBtn = document.getElementById('delete-modal-btn-confirm');
    const deleteModal = document.getElementById('delete-confirm-modal');

    if (cancelBtn) cancelBtn.addEventListener('click', closeDeleteModal);
    if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteFile);
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                closeDeleteModal();
            }
        });
    }

    // Keyboard overlay handlers (Escape to close open modals)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (deleteModal && !deleteModal.classList.contains('hidden')) {
                closeDeleteModal();
                return;
            }
            const viewerModal = document.getElementById('file-viewer-modal');
            if (viewerModal && !viewerModal.classList.contains('hidden')) {
                closeFileViewer();
                return;
            }
        }

        // Educational mode key listeners
        if (window.location.hash.startsWith('#/educational')) {
            // Check if focus is inside any text fields (input, textarea, Monaco editors)
            const active = document.activeElement;
            if (active) {
                const tagName = active.tagName.toLowerCase();
                const isInput = tagName === 'input' || tagName === 'textarea' || active.isContentEditable || active.closest('.monaco-editor');
                if (isInput) return;
            }

            const stepperActive = (window.executionTrace && window.executionTrace.length > 0 && window.currentExecutionStep >= 0);

            if (stepperActive) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    nextExecutionStep();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    prevExecutionStep();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    stopExecutionStepper();
                }
            } else {
                // Regular AST traversal (only if AST panel is visible)
                const astPanel = document.getElementById('edu-ast-panel');
                if (astPanel && !astPanel.classList.contains('hidden')) {
                    if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        stepTraversal(1);
                    } else if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        stepTraversal(-1);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        resetTraversal();
                    }
                }
            }
        }
    });
});
