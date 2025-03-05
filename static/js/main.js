// Globalne zmienne
let editors = new Map();
let scriptCounter = 1;
let saveTimeout;

// Globalna funkcja autoSaveScript – zapisuje lub aktualizuje skrypt
function autoSaveScript(editor) {
  const tabPane = editor.getTextArea().closest('.tab-pane');
  const tabButton = document.querySelector(`[data-bs-target="#${tabPane.id}"]`);
  const title = tabButton.dataset.originalName || tabButton.childNodes[0].nodeValue.trim();
  const payload = JSON.stringify({ title: title, content: editor.getValue() });
  // Jeśli karta ma przypisany identyfikator, wykonujemy aktualizację (PUT)
  if (tabButton.dataset.scriptId) {
    fetch(`/api/scripts/${tabButton.dataset.scriptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    })
      .then(response => response.json())
      .then(data => {
        tabButton.dataset.scriptId = data.id;
      });
  } else {
    // Jeśli nie – wykonujemy POST i zapisujemy otrzymany id w karcie
    fetch('/api/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    })
      .then(response => response.json())
      .then(data => {
        tabButton.dataset.scriptId = data.id;
      });
  }
}

document.addEventListener('DOMContentLoaded', function() {
  // Inicjalizacja CodeMirror dla danego elementu <textarea>
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
      extraKeys: { "Tab": function(cm) { cm.replaceSelection("    "); } }
    });
    editor.on('change', function() {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => autoSaveScript(editor), 1000);
    });
    return editor;
  }

  // Wczytywanie zapisanych skryptów z backendu
  function loadScripts() {
    fetch('/api/scripts')
      .then(response => response.json())
      .then(scripts => {
        if (scripts.length > 0) {
          const firstScript = scripts[0];
          const firstEditor = editors.get('script1');
          firstEditor.setValue(firstScript.content);
          const firstTab = document.querySelector('#script1-tab');
          firstTab.dataset.originalName = firstScript.title;
          firstTab.childNodes[0].nodeValue = firstScript.title;
          firstTab.dataset.scriptId = firstScript.id;
          // Tworzymy kolejne karty (jeśli są)
          for (let i = 1; i < scripts.length; i++) {
            createNewTab(scripts[i].title, scripts[i].content, scripts[i].id);
          }
        }
      });
  }

  // Obsługa edycji nazwy karty (podwójne kliknięcie)
  document.addEventListener('dblclick', function(e) {
    const tabButton = e.target.closest('.nav-link');
    if (!tabButton) return;
    let currentName = tabButton.dataset.originalName || tabButton.childNodes[0].nodeValue.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'form-control form-control-sm d-inline-block w-auto';
    input.style.height = '24px';
    input.style.fontSize = '14px';
    tabButton.innerHTML = '';
    tabButton.appendChild(input);
    input.focus();
    input.select();
    function saveTabName() {
      const newName = input.value.trim() || currentName;
      tabButton.dataset.originalName = newName;
      tabButton.innerHTML = newName + ' <span class="ms-2 close-tab" onclick="removeTab(this)">×</span>';
      const tabId = tabButton.getAttribute('data-bs-target').slice(1);
      const editor = editors.get(tabId);
      autoSaveScript(editor);
    }
    input.addEventListener('blur', saveTabName);
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') { saveTabName(); e.preventDefault(); }
    });
  });

  // Funkcja do tworzenia nowej karty
  function createNewTab(title = null, content = null, scriptId = null) {
    scriptCounter++;
    const tabId = `script${scriptCounter}`;
    title = title || `Script ${scriptCounter}`;
    const newTab = document.createElement('li');
    newTab.className = 'nav-item';
    newTab.role = 'presentation';
    newTab.innerHTML = `
      <button class="nav-link" id="${tabId}-tab" data-bs-toggle="tab" data-bs-target="#${tabId}" type="button" role="tab" data-original-name="${title}" ${scriptId ? `data-script-id="${scriptId}"` : ''}>
        ${title}
        <span class="ms-2 close-tab" onclick="removeTab(this)">×</span>
      </button>
    `;
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
        <div class="console-container mt-2">
          <input type="text" class="console-input form-control" placeholder="Type input and press Enter">
        </div>
      </div>
    `;
    document.querySelector('#scriptTabs').appendChild(newTab);
    document.querySelector('#scriptTabContent').appendChild(newContent);
    const newEditor = initCodeEditor(newContent.querySelector('.code-editor'));
    editors.set(tabId, newEditor);
    const tabInstance = bootstrap.Tab.getOrCreateInstance(document.querySelector(`#${tabId}-tab`));
    tabInstance.show();
    newEditor.refresh();
    setTimeout(() => autoSaveScript(newEditor), 100);
  }

  // Obsługa przycisku "New Script"
  document.getElementById('new-tab').addEventListener('click', function() {
    createNewTab();
  });

  // Obsługa uruchamiania kodu
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('run-code') || e.target.closest('.run-code')) {
      const button = e.target.closest('.run-code');
      const tabPane = button.closest('.tab-pane');
      const tabId = tabPane.id;
      const editor = editors.get(tabId);
      const outputDiv = tabPane.querySelector('.output');
      const code = editor.getValue();
      outputDiv.textContent = 'Running...';
      fetch('/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'default' },
        body: JSON.stringify({ code: code })
      })
      .then(response => response.json())
      .then(data => {
        if (data.error) {
          outputDiv.textContent = 'Error: ' + data.error;
          outputDiv.style.color = 'var(--bs-danger)';
        } else {
          outputDiv.textContent = data.output;
          outputDiv.style.color = 'var(--bs-light)';
        }
      })
      .catch(error => {
        outputDiv.textContent = 'Error: ' + error.message;
        outputDiv.style.color = 'var(--bs-danger)';
      });
    }
  });

  // Przycisk "Clear" – czyści zawartość outputu
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('clear-output')) {
      const tabPane = e.target.closest('.tab-pane');
      const outputDiv = tabPane.querySelector('.output');
      outputDiv.textContent = '';
    }
  });

  // Obsługa interaktywnego inputu – gdy użytkownik wciska Enter w polu input
  document.addEventListener('keypress', function(e) {
    if (e.target && e.target.classList.contains('console-input') && e.key === 'Enter') {
      const inputVal = e.target.value;
      fetch('/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-ID': 'default' },
        body: JSON.stringify({ input: inputVal })
      })
      .then(response => response.json())
      .then(data => { e.target.value = ''; })
      .catch(error => { console.error('Input error:', error); });
    }
  });

  loadScripts();
});

// Globalna funkcja usuwania karty
window.removeTab = function(elem) {
  const tab = elem.closest('.nav-item');
  const tabButton = tab.querySelector('.nav-link');
  const scriptId = tabButton.dataset.scriptId;
  if (scriptId) {
    fetch(`/api/scripts/${scriptId}`, { method: 'DELETE' });
  }
  const tabId = tabButton.getAttribute('data-bs-target').slice(1);
  const content = document.getElementById(tabId);
  editors.delete(tabId);
  tab.remove();
  content.remove();
  // Jeśli istnieje karta 'script1', ją aktywujemy
  if (document.querySelector('#script1-tab')) {
    bootstrap.Tab.getOrCreateInstance(document.querySelector('#script1-tab')).show();
  }
};

// Funkcje globalne wywoływane z HTML:
window.saveCode = function(button) {
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
};

window.triggerLoad = function(button) {
  const fileInput = button.closest('.tab-pane').querySelector('.load-file');
  fileInput.click();
};

window.loadCode = function(input) {
  const file = input.files[0];
  if (file) {
    const tabPane = input.closest('.tab-pane');
    const tabId = tabPane.id;
    const editor = editors.get(tabId);
    const reader = new FileReader();
    reader.onload = function(e) {
      editor.setValue(e.target.result);
      autoSaveScript(editor);
    };
    reader.readAsText(file);
  }
};
