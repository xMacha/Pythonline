// Initialize code editor
document.addEventListener('DOMContentLoaded', function() {
    let editors = new Map();
    let scriptCounter = 1;
    let saveTimeout;

    function initCodeEditor(element) {
        const editor = CodeMirror.fromTextArea(element, {
            mode: 'python',
            theme: 'darcula',
            lineNumbers: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 4,
            tabSize: 4,
            indentWithTabs: false,
            extraKeys: {
                "Tab": function(cm) {
                    cm.replaceSelection("    ");
                }
            }
        });

        // Add auto-save on change
        editor.on('change', function() {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => autoSaveScript(editor), 1000);
        });

        return editor;
    }

    // Initialize first editor
    if (document.querySelector('.code-editor')) {
        const firstEditor = initCodeEditor(document.querySelector('.code-editor'));
        editors.set('script1', firstEditor);
        loadScripts(); // Load saved scripts on page load
    }

    // Auto-save function
    function autoSaveScript(editor) {
        if (!document.querySelector('.code-editor')) return;

        const tabPane = editor.getTextArea().closest('.tab-pane');
        const tabId = tabPane.id;
        const tabButton = document.querySelector(`[data-bs-target="#${tabId}"]`);
        const title = tabButton.textContent.trim().split('×')[0].trim();

        fetch('/api/scripts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: title,
                content: editor.getValue()
            })
        });
    }

    // Load saved scripts
    function loadScripts() {
        fetch('/api/scripts')
            .then(response => response.json())
            .then(scripts => {
                scripts.forEach((script, index) => {
                    if (index === 0) {
                        // Update first tab
                        const firstEditor = editors.get('script1');
                        firstEditor.setValue(script.content);
                        const firstTab = document.querySelector('#script1-tab');
                        firstTab.textContent = script.title;
                    } else {
                        // Create new tabs for other scripts
                        createNewTab(script.title, script.content);
                    }
                });
            });
    }

    // Add double-click event for tab renaming
    document.addEventListener('dblclick', function(e) {
        const tabButton = e.target.closest('.nav-link');
        if (tabButton && !tabButton.querySelector('input')) {
            const currentText = tabButton.textContent.trim();
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentText;
            input.className = 'form-control form-control-sm d-inline-block w-auto';
            input.style.height = '24px';
            input.style.fontSize = '14px';

            // Store the original content
            const originalContent = tabButton.innerHTML;
            tabButton.innerHTML = '';
            tabButton.appendChild(input);
            input.focus();
            input.select();

            function saveTabName() {
                const newName = input.value.trim() || originalContent.split('×')[0].trim();
                tabButton.innerHTML = newName + ' <span class="ms-2 close-tab" onclick="event.stopPropagation();">&times;</span>';

                // Auto-save after rename
                const tabId = tabButton.getAttribute('data-bs-target').slice(1);
                const editor = editors.get(tabId);
                autoSaveScript(editor);
            }

            input.addEventListener('blur', saveTabName);
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    saveTabName();
                    e.preventDefault();
                }
            });
        }
    });

    function createNewTab(title = null, content = null) {
        scriptCounter++;
        const tabId = `script${scriptCounter}`;
        title = title || `Script ${scriptCounter}`;

        // Create new tab
        const newTab = document.createElement('li');
        newTab.className = 'nav-item';
        newTab.role = 'presentation';
        newTab.innerHTML = `
            <button class="nav-link" id="${tabId}-tab" data-bs-toggle="tab" data-bs-target="#${tabId}" type="button" role="tab">
                ${title}
                <span class="ms-2 close-tab" onclick="event.stopPropagation();">&times;</span>
            </button>
        `;

        // Create new content
        const newContent = document.createElement('div');
        newContent.className = 'tab-pane fade';
        newContent.id = tabId;
        newContent.role = 'tabpanel';
        newContent.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <button class="btn btn-outline-primary me-2" onclick="saveCode(this)">
                        <i class="fas fa-save me-2"></i>Save to Disk
                    </button>
                    <input type="file" class="load-file d-none" accept=".py" onchange="loadCode(this)">
                    <button class="btn btn-outline-primary" onclick="triggerLoad(this)">
                        <i class="fas fa-folder-open me-2"></i>Load from Disk
                    </button>
                </div>
                <button class="btn btn-primary run-code">
                    <i class="fas fa-play me-2"></i>Run Code
                </button>
            </div>
            <textarea class="code-editor form-control">${content || 'print("Hello, World!")'}</textarea>
            <div class="mt-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h5 class="mb-0">Output:</h5>
                    <button class="btn btn-sm btn-outline-secondary clear-output">
                        <i class="fas fa-trash me-1"></i>Clear
                    </button>
                </div>
                <pre class="output bg-dark text-light p-3 rounded">Run your code to see the output</pre>
            </div>
        `;

        // Add to DOM
        document.querySelector('#scriptTabs').appendChild(newTab);
        document.querySelector('#scriptTabContent').appendChild(newContent);

        // Initialize new editor
        const newEditor = initCodeEditor(newContent.querySelector('.code-editor'));
        editors.set(tabId, newEditor);

        // Show new tab
        bootstrap.Tab.getOrCreateInstance(document.querySelector(`#${tabId}-tab`)).show();

        // Auto-save new tab
        setTimeout(() => autoSaveScript(newEditor), 100);
    }

    // New tab button functionality
    document.getElementById('new-tab').addEventListener('click', function() {
        createNewTab();
    });

    // Close tab functionality
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('close-tab')) {
            const tab = e.target.closest('.nav-item');
            const tabId = tab.querySelector('.nav-link').getAttribute('data-bs-target').slice(1);
            const content = document.getElementById(tabId);

            // Delete script from server
            fetch(`/api/scripts/${tabId}`, { method: 'DELETE' });

            // Remove editor from map
            editors.delete(tabId);

            // Remove tab and content
            tab.remove();
            content.remove();

            // Show first tab if available
            if (document.querySelector('#script1-tab')) {
                bootstrap.Tab.getOrCreateInstance(document.querySelector('#script1-tab')).show();
            }
        }
    });

    // Run code functionality
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('run-code') || e.target.closest('.run-code')) {
            const button = e.target.classList.contains('run-code') ? e.target : e.target.closest('.run-code');
            const tabPane = button.closest('.tab-pane');
            const tabId = tabPane.id;
            const editor = editors.get(tabId);
            const outputDiv = tabPane.querySelector('.output');

            const code = editor.getValue();
            outputDiv.textContent = 'Running...';

            fetch('/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code: code })
            })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    outputDiv.textContent = 'Error: ' + data.error;
                    outputDiv.style.color = 'var(--bs-danger)';
                } else {
                    outputDiv.textContent = data.output;
                    output.style.color = 'var(--bs-light)';
                }
            })
            .catch(error => {
                outputDiv.textContent = 'Error: ' + error.message;
                outputDiv.style.color = 'var(--bs-danger)';
            });
        }
    });
});

// Save code functionality
function saveCode(button) {
    const tabPane = button.closest('.tab-pane');
    const tabId = tabPane.id;
    const editor = editors.get(tabId);
    const code = editor.getValue();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tabId}.py`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// Load code functionality
function triggerLoad(button) {
    const fileInput = button.closest('.tab-pane').querySelector('.load-file');
    fileInput.click();
}

function loadCode(input) {
    const file = input.files[0];
    if (file) {
        const tabPane = input.closest('.tab-pane');
        const tabId = tabPane.id;
        const editor = editors.get(tabId);

        const reader = new FileReader();
        reader.onload = function(e) {
            editor.setValue(e.target.result);
            // Auto-save after loading from disk
            autoSaveScript(editor);
        };
        reader.readAsText(file);
    }
}

// Form validation
const forms = document.querySelectorAll('.needs-validation');
Array.from(forms).forEach(form => {
    form.addEventListener('submit', event => {
        if (!form.checkValidity()) {
            event.preventDefault();
            event.stopPropagation();
        }
        form.classList.add('was-validated');
    }, false);
});

// Alert animation
const alerts = document.querySelectorAll('.alert');
alerts.forEach(alert => {
    setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 150);
    }, 3000);
});
