/* ============================================================
   BABA LINDAO DEUS — ADMIN
   Arquivo único: config + inicialização + lógica.
   Usa o SDK clássico do Firebase (compat), carregado via <script>
   no HTML, por exemplo:

     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
     <script src="admin.js"></script>

   Nenhum import/export — tudo dentro de uma IIFE.
   ============================================================ */
(function () {

  /* ---------------------------------------------------------
     CONFIGURAÇÃO DO FIREBASE
     Preencha com os dados do seu projeto (Configurações do
     projeto → Seus apps → app da Web).
  --------------------------------------------------------- */
  var firebaseConfig = {
    apiKey: "AIzaSyAa5yO2HSOGyUOCqKXKUEEsqGPKHOv78Es",
  authDomain: "babalindo-feb02.firebaseapp.com",
  projectId: "babalindo-feb02",
  storageBucket: "babalindo-feb02.firebasestorage.app",
  messagingSenderId: "620496011247",
  appId: "1:620496011247:web:6095a42681b7b56fbb801a",
  measurementId: "G-VM4XKBE0KF"

  };

  firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  var db   = firebase.firestore();

  // Sessão isolada por aba: evita que o site do usuário (mesmo domínio
  // no GitHub Pages) derrube o login deste site do admin, e vice-versa.
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

  var STATUS = {
    PENDENTE:   "pendente",
    ACEITO:     "aceito",
    ANDAMENTO:  "andamento",
    FINALIZADO: "finalizado"
  };

  var STATUS_LABEL = {
    pendente:   "Pendente",
    aceito:     "Aceito",
    andamento:  "Em andamento",
    finalizado: "Finalizado"
  };

  /* ============================================================
     ESTADO
  ============================================================ */
  var itemsCache  = [];
  var modelsCache = [];
  var blocksCache = [];
  var usersCache  = [];

  var editingItemId  = null;
  var editingModelId = null;   // null = novo modelo
  var modelBuilderItems = [];  // itens sendo editados no editor de modelo
  var blockBuilderItems = [];  // itens sendo montados no Novo Bloco

  /* ============================================================
     LOGIN / GUARD DE AUTENTICAÇÃO
  ============================================================ */
  var authShell   = document.getElementById("auth-shell");
  var appShell    = document.getElementById("app-shell");
  var authError   = document.getElementById("auth-error");
  var loginForm   = document.getElementById("login-form");
  var loginBtn    = document.getElementById("login-btn");
  var bootStarted = false;

  function showLogin(message) {
    appShell.classList.add("hidden");
    authShell.classList.remove("hidden");
    if (message) {
      authError.textContent = message;
      authError.classList.add("show");
    } else {
      authError.textContent = "";
      authError.classList.remove("show");
    }
  }

  function showApp() {
    authShell.classList.add("hidden");
    appShell.classList.remove("hidden");
  }

  function loginErrorMessage(err) {
    switch (err && err.code) {
      case "auth/invalid-email":       return "E-mail inválido.";
      case "auth/user-disabled":       return "Esta conta foi desativada.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":  return "E-mail ou senha incorretos.";
      case "auth/too-many-requests":   return "Muitas tentativas. Tente novamente mais tarde.";
      case "auth/network-request-failed": return "Falha de conexão. Verifique sua internet.";
      default:                          return "Não foi possível entrar. Tente novamente.";
    }
  }

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = document.getElementById("login-email").value.trim();
    var password = document.getElementById("login-password").value;
    if (!email || !password) return;

    loginBtn.disabled = true;
    loginBtn.textContent = "Entrando...";
    authError.classList.remove("show");

    auth.signInWithEmailAndPassword(email, password)
      .catch(function (err) {
        showLogin(loginErrorMessage(err));
      })
      .finally(function () {
        loginBtn.disabled = false;
        loginBtn.textContent = "Entrar";
      });
  });

  auth.onAuthStateChanged(function (user) {
    if (!user) { bootStarted = false; showLogin(); return; }

    db.collection("users").doc(user.uid).get().then(function (snap) {
      var profile = snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;

      if (!profile || profile.role !== "admin") {
        auth.signOut();
        showLogin("Esta conta não tem permissão de administrador.");
        return;
      }

      document.getElementById("user-name").textContent = profile.name || user.email;
      document.getElementById("user-initial").textContent = (profile.name || user.email).charAt(0).toUpperCase();

      showApp();
      if (!bootStarted) { bootStarted = true; boot(); }
    }).catch(function () {
      auth.signOut();
      showLogin("Erro ao verificar sua conta. Tente novamente.");
    });
  });

  document.getElementById("logout-btn").addEventListener("click", function () {
    auth.signOut();
  });

  /* ============================================================
     NAVEGAÇÃO ENTRE VIEWS
  ============================================================ */
  function switchView(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
    document.querySelectorAll(".nav-item").forEach(function (n) { n.classList.remove("active"); });
    document.getElementById("view-" + name).classList.add("active");
    var nav = document.querySelector('.nav-item[data-view="' + name + '"]');
    if (nav) nav.classList.add("active");
  }

  document.querySelectorAll(".nav-item[data-view]").forEach(function (el) {
    el.addEventListener("click", function () { switchView(el.dataset.view); });
  });

  /* ============================================================
     TOAST
  ============================================================ */
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ============================================================
     HELPERS DE UI COMPARTILHADOS
  ============================================================ */
  function statusBadge(status) {
    return '<span class="badge ' + status + '">' + (STATUS_LABEL[status] || status) + '</span>';
  }

  function fmtDate(ts) {
    if (!ts || !ts.toDate) return "";
    return ts.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  /** Renderiza a lista editável de itens de um modelo/bloco em construção. */
  function renderBuilderItems(containerId, itemsArray, onChange) {
    var container = document.getElementById(containerId);
    if (itemsArray.length === 0) {
      container.innerHTML = '<p class="muted small">Nenhum item adicionado ainda.</p>';
      return;
    }
    container.innerHTML = itemsArray.map(function (it, idx) {
      return '' +
        '<div class="item-line">' +
        '<span class="item-name">' + it.itemName + '</span>' +
        '<input type="number" min="1" class="qty-input" data-idx="' + idx + '" value="' + it.quantity + '">' +
        '<span class="small muted">un.</span>' +
        '<span class="remove" data-idx="' + idx + '" style="cursor:pointer;">Remover</span>' +
        '</div>';
    }).join("");

    container.querySelectorAll(".qty-input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var idx = Number(inp.dataset.idx);
        var val = Math.max(1, parseInt(inp.value, 10) || 1);
        itemsArray[idx].quantity = val;
        inp.value = val;
      });
    });
    container.querySelectorAll(".remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        itemsArray.splice(Number(btn.dataset.idx), 1);
        onChange();
      });
    });
  }

  function fillItemSelect(selectEl, placeholder) {
    selectEl.innerHTML = '<option value="">' + placeholder + '</option>' +
      itemsCache.map(function (i) { return '<option value="' + i.id + '">' + i.name + '</option>'; }).join("");
  }

  function addItemToBuilder(itemsArray, itemId) {
    if (!itemId) return;
    var item = itemsCache.find(function (i) { return i.id === itemId; });
    if (!item) return;
    var existing = itemsArray.find(function (i) { return i.itemId === itemId; });
    if (existing) { existing.quantity += 1; return; }
    itemsArray.push({
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      description: item.description || ""
    });
  }

  /* ============================================================
     BOOT — assina as coleções em tempo real
  ============================================================ */
  function boot() {
    db.collection("items").orderBy("name").onSnapshot(function (snap) {
      var items = [];
      snap.forEach(function (d) { items.push(Object.assign({ id: d.id }, d.data())); });
      itemsCache = items.filter(function (i) { return i.active !== false; });

      renderItens();
      fillItemSelect(document.getElementById("modelo-select-item"), "Selecione um item");
      fillItemSelect(document.getElementById("bloco-select-item"), "Selecione um item");
      renderDashboard();
    });

    db.collection("models").orderBy("name").onSnapshot(function (snap) {
      var models = [];
      snap.forEach(function (d) { models.push(Object.assign({ id: d.id }, d.data())); });
      modelsCache = models;

      renderModelos();
      fillModeloSelectNoBloco();
      renderDashboard();
    });

    db.collection("blocks").orderBy("createdAt", "desc").onSnapshot(function (snap) {
      var blocks = [];
      snap.forEach(function (d) { blocks.push(Object.assign({ id: d.id }, d.data())); });
      blocksCache = blocks;

      renderBlocos();
      renderHistorico();
      renderDashboard();
    });

    db.collection("users").where("role", "==", "user").get().then(function (snap) {
      var users = [];
      snap.forEach(function (d) { users.push(Object.assign({ id: d.id }, d.data())); });
      usersCache = users;

      var sel = document.getElementById("bloco-destinatario");
      sel.innerHTML = '<option value="">Selecione um usuário</option>' +
        users.map(function (u) { return '<option value="' + u.id + '">' + (u.name || u.id) + '</option>'; }).join("");
    });
  }

  /* ============================================================
     DASHBOARD
  ============================================================ */
  function renderDashboard() {
    document.getElementById("m-itens").textContent = itemsCache.length;
    document.getElementById("m-modelos").textContent = modelsCache.length;
    document.getElementById("m-pendentes").textContent = blocksCache.filter(function (b) { return b.status === STATUS.PENDENTE; }).length;
    document.getElementById("m-andamento").textContent = blocksCache.filter(function (b) { return b.status === STATUS.ACEITO || b.status === STATUS.ANDAMENTO; }).length;
    document.getElementById("m-finalizados").textContent = blocksCache.filter(function (b) { return b.status === STATUS.FINALIZADO; }).length;

    var recent = blocksCache.slice(0, 5);
    var container = document.getElementById("dashboard-recent");
    container.innerHTML = recent.length ? recent.map(function (b) {
      return '' +
        '<div class="list-row ' + b.status + '">' +
        '<div class="row-main">' +
        '<div class="row-title">' + b.name + '</div>' +
        '<div class="row-sub">Para ' + (b.assignedToName || "—") + ' · ' + fmtDate(b.createdAt) + '</div>' +
        '</div>' +
        '<div class="row-side">' + statusBadge(b.status) + '</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nenhum bloco ainda</h3><p>Crie o primeiro bloco na aba "Novo Bloco".</p></div>';
  }

  /* ============================================================
     ITENS
  ============================================================ */
  function renderItens() {
    var container = document.getElementById("lista-itens");
    container.innerHTML = itemsCache.length ? itemsCache.map(function (i) {
      return '' +
        '<div class="list-row" data-id="' + i.id + '">' +
        '<div class="row-main">' +
        '<div class="row-title">' + i.name + '</div>' +
        '<div class="row-sub">' + (i.description || "Sem descrição") + '</div>' +
        '</div>' +
        '<div class="row-side">UNIDADE</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nenhum item cadastrado</h3><p>Cadastre o primeiro item para usar em modelos e blocos.</p></div>';

    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openItemModal(row.dataset.id); });
    });
  }

  function openItemModal(id) {
    editingItemId = id || null;
    var item = id ? itemsCache.find(function (i) { return i.id === id; }) : null;
    document.getElementById("modal-item-titulo").textContent = item ? "Editar item" : "Novo item";
    document.getElementById("item-nome").value = item ? item.name : "";
    document.getElementById("item-descricao").value = item ? item.description || "" : "";
    document.getElementById("btn-desativar-item").classList.toggle("hidden", !item);
    document.getElementById("modal-item").classList.add("active");
  }

  document.getElementById("btn-novo-item").addEventListener("click", function () { openItemModal(null); });
  document.getElementById("btn-cancelar-item").addEventListener("click", function () {
    document.getElementById("modal-item").classList.remove("active");
  });

  document.getElementById("btn-salvar-item").addEventListener("click", function () {
    var name = document.getElementById("item-nome").value.trim();
    var description = document.getElementById("item-descricao").value.trim();
    if (!name) { toast("O nome do item é obrigatório."); return; }

    var payload = { name: name, description: description };
    var promise = editingItemId
      ? db.collection("items").doc(editingItemId).update(payload)
      : db.collection("items").add(Object.assign({}, payload, {
          unit: "UNIDADE",
          active: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }));

    promise.then(function () {
      toast(editingItemId ? "Item atualizado." : "Item cadastrado.");
      document.getElementById("modal-item").classList.remove("active");
    }).catch(function () {
      toast("Erro ao salvar item.");
    });
  });

  document.getElementById("btn-desativar-item").addEventListener("click", function () {
    if (!editingItemId) return;
    if (!confirm("Desativar este item? Ele deixará de aparecer em novos modelos e blocos.")) return;
    db.collection("items").doc(editingItemId).update({ active: false }).then(function () {
      toast("Item desativado.");
      document.getElementById("modal-item").classList.remove("active");
    });
  });

  /* ============================================================
     MODELOS
  ============================================================ */
  function renderModelos() {
    var container = document.getElementById("lista-modelos");
    container.innerHTML = modelsCache.length ? modelsCache.map(function (m) {
      return '' +
        '<div class="list-row" data-id="' + m.id + '">' +
        '<div class="row-main">' +
        '<div class="row-title">' + m.name + '</div>' +
        '<div class="row-sub">' + (m.description || "Sem descrição") + '</div>' +
        '</div>' +
        '<div class="row-side">' + m.items.length + ' ' + (m.items.length === 1 ? "item" : "itens") + '</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nenhum modelo cadastrado</h3><p>Crie um modelo para reutilizar conjuntos de itens.</p></div>';

    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openModelEditor(row.dataset.id); });
    });
  }

  function fillModeloSelectNoBloco() {
    var sel = document.getElementById("bloco-usar-modelo");
    sel.innerHTML = '<option value="">— Começar vazio —</option>' +
      modelsCache.map(function (m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join("");
  }

  function openModelEditor(id) {
    editingModelId = id || null;

    var loadModel = id
      ? db.collection("models").doc(id).get().then(function (snap) {
          return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
        })
      : Promise.resolve(null);

    loadModel.then(function (model) {
      document.getElementById("editor-modelo-titulo").textContent = model ? model.name : "Novo modelo";
      document.getElementById("modelo-nome").value = model ? model.name : "";
      document.getElementById("modelo-descricao").value = model ? (model.description || "") : "";
      document.getElementById("btn-excluir-modelo").classList.toggle("hidden", !model);

      // cópia local — não afeta o modelo original até "Salvar modelo"
      modelBuilderItems = model ? model.items.map(function (i) { return Object.assign({}, i); }) : [];
      renderModeloBuilder();
      switchView("editor-modelo");
    });
  }

  function renderModeloBuilder() {
    renderBuilderItems("modelo-itens-lista", modelBuilderItems, renderModeloBuilder);
  }

  document.getElementById("btn-novo-modelo").addEventListener("click", function () { openModelEditor(null); });
  document.getElementById("btn-cancelar-modelo").addEventListener("click", function () { switchView("modelos"); });

  document.getElementById("btn-add-item-modelo").addEventListener("click", function () {
    var sel = document.getElementById("modelo-select-item");
    addItemToBuilder(modelBuilderItems, sel.value);
    sel.value = "";
    renderModeloBuilder();
  });

  document.getElementById("btn-salvar-modelo").addEventListener("click", function () {
    var name = document.getElementById("modelo-nome").value.trim();
    var description = document.getElementById("modelo-descricao").value.trim();
    if (!name) { toast("O nome do modelo é obrigatório."); return; }

    var promise = editingModelId
      ? db.collection("models").doc(editingModelId).update({
          name: name,
          description: description,
          items: modelBuilderItems,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        })
      : db.collection("models").add({
          name: name,
          description: description,
          items: modelBuilderItems,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

    promise.then(function () {
      toast(editingModelId ? "Modelo atualizado." : "Modelo criado.");
      switchView("modelos");
    }).catch(function () {
      toast("Erro ao salvar modelo.");
    });
  });

  document.getElementById("btn-excluir-modelo").addEventListener("click", function () {
    if (!editingModelId) return;
    if (!confirm("Excluir este modelo? Blocos já criados a partir dele não serão afetados.")) return;
    db.collection("models").doc(editingModelId).delete().then(function () {
      toast("Modelo excluído.");
      switchView("modelos");
    });
  });

  /* ============================================================
     NOVO BLOCO
  ============================================================ */
  function renderBlocoBuilder() {
    renderBuilderItems("bloco-itens-lista", blockBuilderItems, renderBlocoBuilder);
  }

  document.getElementById("bloco-usar-modelo").addEventListener("change", function (e) {
    var modelId = e.target.value;
    if (!modelId) { blockBuilderItems = []; renderBlocoBuilder(); return; }
    var model = modelsCache.find(function (m) { return m.id === modelId; });
    if (!model) return;
    // cópia independente — editar aqui nunca altera o modelo original
    blockBuilderItems = model.items.map(function (i) { return Object.assign({}, i); });
    if (!document.getElementById("bloco-nome").value) {
      document.getElementById("bloco-nome").value = model.name;
    }
    renderBlocoBuilder();
  });

  document.getElementById("btn-add-item-bloco").addEventListener("click", function () {
    var sel = document.getElementById("bloco-select-item");
    addItemToBuilder(blockBuilderItems, sel.value);
    sel.value = "";
    renderBlocoBuilder();
  });

  document.getElementById("btn-enviar-bloco").addEventListener("click", function () {
    var name = document.getElementById("bloco-nome").value.trim();
    var description = document.getElementById("bloco-descricao").value.trim();
    var destSel = document.getElementById("bloco-destinatario");
    var assignedTo = destSel.value;
    var assignedToName = destSel.selectedOptions[0] ? destSel.selectedOptions[0].textContent : "";
    var modelId = document.getElementById("bloco-usar-modelo").value || null;

    if (!name) { toast("Dê um nome ao bloco."); return; }
    if (!assignedTo) { toast("Selecione para quem enviar."); return; }
    if (blockBuilderItems.length === 0) { toast("Adicione pelo menos um item."); return; }

    db.collection("blocks").add({
      name: name,
      description: description,
      modelId: modelId,
      assignedTo: assignedTo,
      assignedToName: assignedToName,
      items: blockBuilderItems,
      status: STATUS.PENDENTE,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      toast("Bloco criado e enviado.");
      document.getElementById("bloco-nome").value = "";
      document.getElementById("bloco-descricao").value = "";
      document.getElementById("bloco-usar-modelo").value = "";
      destSel.value = "";
      blockBuilderItems = [];
      renderBlocoBuilder();
      switchView("blocos");
    }).catch(function () {
      toast("Erro ao enviar bloco.");
    });
  });

  /* ============================================================
     BLOCOS / HISTÓRICO (leitura + status)
  ============================================================ */
  function renderBlockRow(b) {
    return '' +
      '<div class="list-row ' + b.status + '" data-id="' + b.id + '">' +
      '<div class="row-main">' +
      '<div class="row-title">' + b.name + '</div>' +
      '<div class="row-sub">Para ' + (b.assignedToName || "—") + ' · ' + b.items.length + ' itens · ' + fmtDate(b.createdAt) + '</div>' +
      '</div>' +
      '<div class="row-side">' + statusBadge(b.status) + '</div>' +
      '</div>';
  }

  function renderBlocos() {
    var ativos = blocksCache.filter(function (b) { return b.status !== STATUS.FINALIZADO; });
    var container = document.getElementById("lista-blocos");
    container.innerHTML = ativos.length ? ativos.map(renderBlockRow).join("")
      : '<div class="empty-state"><h3>Nenhum bloco em andamento</h3><p>Os blocos enviados aparecerão aqui até serem finalizados.</p></div>';
    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openBlockDetail(row.dataset.id); });
    });
  }

  function renderHistorico() {
    var finalizados = blocksCache.filter(function (b) { return b.status === STATUS.FINALIZADO; });
    var container = document.getElementById("lista-historico");
    container.innerHTML = finalizados.length ? finalizados.map(renderBlockRow).join("")
      : '<div class="empty-state"><h3>Nenhum bloco finalizado ainda</h3></div>';
    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openBlockDetail(row.dataset.id); });
    });
  }

  function openBlockDetail(id) {
    var b = blocksCache.find(function (x) { return x.id === id; });
    if (!b) return;
    document.getElementById("detalhe-bloco-nome").textContent = b.name;
    document.getElementById("detalhe-bloco-destino").textContent = "Enviado para " + (b.assignedToName || "—") + " em " + fmtDate(b.createdAt);
    document.getElementById("detalhe-bloco-descricao").textContent = b.description || "";
    document.getElementById("detalhe-bloco-itens").innerHTML = b.items.map(function (i) {
      return '<div class="item-line"><span class="item-name">' + i.itemName + '</span><span class="small muted">' + i.quantity + ' un.</span></div>';
    }).join("");
    document.getElementById("detalhe-bloco-status").outerHTML =
      statusBadge(b.status).replace('<span class="badge', '<span id="detalhe-bloco-status" class="badge');
    document.getElementById("modal-bloco").classList.add("active");
  }

  document.getElementById("btn-fechar-detalhe").addEventListener("click", function () {
    document.getElementById("modal-bloco").classList.remove("active");
  });

})();