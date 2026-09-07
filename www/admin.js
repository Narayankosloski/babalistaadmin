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

  // Versão publicada deste site — comparada com "config/app" no Firestore
  // pra avisar quando tiver uma versão mais nova (ver btn-salvar-versao-admin
  // no Perfil, onde essa versão é publicada depois de cada deploy).
  var APP_VERSION = "1.0.0";
  var currentProfile = null; // perfil (nome, role) da pessoa logada

  // No navegador (GitHub Pages), os dois sites (admin e usuário) ficam no
  // mesmo domínio e compartilham o localStorage — por isso usamos SESSION
  // aqui, pra logar em um não derrubar o outro. Já dentro do app instalado
  // (Capacitor), cada site roda isolado no seu próprio app, então não tem
  // esse conflito — nesse caso usamos LOCAL pra manter a pessoa logada
  // entre uma abertura e outra do app, sem precisar digitar a senha toda vez.
  var isAppNativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  auth.setPersistence(isAppNativo ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);

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

  var COMPRA_STATUS_LABEL = {
    pendente:  "Pendente",
    aprovado:  "Aprovado",
    rejeitado: "Rejeitado",
    comprado:  "Comprado"
  };

  /* ============================================================
     ESTADO
  ============================================================ */
  var itemsCache  = [];
  var modelsCache = [];
  var blocksCache = [];
  var usersCache  = [];
  var comprasCache = [];
  var categoriesCache = [];

  var editingItemId  = null;
  var editingModelId = null;   // null = novo modelo
  var editingBlockId = null;   // null = nova lista (não editando)
  var modelBuilderItems = [];  // itens sendo editados no editor de modelo
  var blockBuilderItems = [];  // itens sendo montados no Novo Bloco
  var blockBuilderModelIds = []; // comidas já somadas na lista em construção (apenas registro)
  var itensSearchTerm = "";
  var itensCategoryFilter = ""; // "" = todas as categorias

  /** Nome de exibição de uma categoria a partir do id — resolve sempre pelo
      cache (não pelo texto salvo no item), então se a categoria for excluída
      o item passa a aparecer como "Sem categoria" automaticamente. */
  function categoryLabel(categoryId) {
    var c = categoriesCache.find(function (x) { return x.id === categoryId; });
    return c ? c.name : "Sem categoria";
  }

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
      currentProfile = profile;
      renderPerfilHeader(user);

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
     RECARREGAR + AVISO DE CONEXÃO
     Os dados já são atualizados em tempo real via Firestore
     (onSnapshot) — não é preciso "puxar" pra atualizar. O botão de
     recarregar serve pra forçar buscar a versão mais nova do app
     (depois de um update) e resincronizar tudo do zero. O aviso de
     conexão avisa quando a internet cai, já que nesse caso o que
     está na tela pode ficar desatualizado até a conexão voltar.
  ============================================================ */
  document.getElementById("reload-btn").addEventListener("click", function () {
    location.reload();
  });

  function updateOfflineBadge() {
    document.getElementById("offline-badge").classList.toggle("hidden", navigator.onLine);
  }
  window.addEventListener("online", updateOfflineBadge);
  window.addEventListener("offline", updateOfflineBadge);
  updateOfflineBadge();

  /* ============================================================
     NAVEGAÇÃO ENTRE VIEWS + GAVETA LATERAL
  ============================================================ */
  var menuBtn     = document.getElementById("menu-btn");
  var sidebarEl   = document.getElementById("sidebar");
  var navBackdrop = document.getElementById("nav-backdrop");

  function openNav() {
    sidebarEl.classList.add("open");
    navBackdrop.classList.add("open");
    menuBtn.setAttribute("aria-expanded", "true");
  }
  function closeNav() {
    sidebarEl.classList.remove("open");
    navBackdrop.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  }
  menuBtn.addEventListener("click", function () {
    if (sidebarEl.classList.contains("open")) { closeNav(); } else { openNav(); }
  });
  navBackdrop.addEventListener("click", closeNav);

  function switchView(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
    document.querySelectorAll(".nav-item").forEach(function (n) { n.classList.remove("active"); });
    document.querySelectorAll(".tab-item").forEach(function (t) { t.classList.remove("active"); });
    document.getElementById("view-" + name).classList.add("active");
    var nav = document.querySelector('.nav-item[data-view="' + name + '"]');
    if (nav) nav.classList.add("active");
    var tab = document.querySelector('.tab-item[data-view="' + name + '"]');
    if (tab) tab.classList.add("active");
  }

  document.querySelectorAll(".nav-item[data-view]").forEach(function (el) {
    el.addEventListener("click", function () { switchView(el.dataset.view); closeNav(); });
  });

  document.querySelectorAll(".metric-link[data-view]").forEach(function (el) {
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

  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>';

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
        '<span class="item-name">' + it.itemName + (it.modelName ? ' <span class="small muted">— ' + it.modelName + '</span>' : '') + '</span>' +
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

  /** Preenche um <select> de itens agrupado por categoria (<optgroup>),
      pra facilitar achar o item certo quando a lista crescer. Itens sem
      categoria caem no grupo "Sem categoria", sempre por último. */
  function fillItemSelect(selectEl, placeholder) {
    var groups = {};
    var order = [];
    itemsCache.forEach(function (i) {
      var key = i.categoryId || "_sem";
      if (!groups[key]) {
        groups[key] = { label: i.categoryId ? categoryLabel(i.categoryId) : "Sem categoria", items: [] };
        order.push(key);
      }
      groups[key].items.push(i);
    });
    order.sort(function (a, b) {
      if (a === "_sem") return 1;
      if (b === "_sem") return -1;
      return groups[a].label.localeCompare(groups[b].label);
    });

    var html = '<option value="">' + placeholder + '</option>';
    order.forEach(function (key) {
      html += '<optgroup label="' + groups[key].label + '">' +
        groups[key].items.map(function (i) { return '<option value="' + i.id + '">' + i.name + '</option>'; }).join("") +
        '</optgroup>';
    });
    selectEl.innerHTML = html;
  }

  /** Preenche o <select> de categoria dentro do modal de item. */
  function fillItemCategorySelect(selectEl, selectedId) {
    selectEl.innerHTML = '<option value="">Sem categoria</option>' +
      categoriesCache.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === selectedId ? " selected" : "") + '>' + c.name + '</option>';
      }).join("");
  }

  function addItemToBuilder(itemsArray, itemId) {
    if (!itemId) return;
    var item = itemsCache.find(function (i) { return i.id === itemId; });
    if (!item) return;
    var existing = itemsArray.find(function (i) { return i.itemId === itemId && !i.modelId; });
    if (existing) { existing.quantity += 1; return; }
    itemsArray.push({
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      description: item.description || "",
      modelId: null,
      modelName: null
    });
  }

  /**
   * Soma os itens de uma comida (modelo) dentro de uma lista em construção,
   * marcando cada item com a comida de origem (modelId/modelName) para
   * depois ser possível mostrar "o que vai em cada comida" na lista.
   * Se a mesma comida for adicionada de novo, as quantidades dela se somam;
   * itens de comidas diferentes ficam em linhas separadas mesmo que sejam
   * o mesmo item cadastrado. É uma cópia independente — depois de somado,
   * editar aqui nunca altera a comida original, e alterar a comida depois
   * não muda listas já criadas.
   */
  function addModeloToBuilder(itemsArray, modelId) {
    if (!modelId) return;
    var model = modelsCache.find(function (m) { return m.id === modelId; });
    if (!model) return;

    model.items.forEach(function (it) {
      var existing = itemsArray.find(function (x) { return x.itemId === it.itemId && x.modelId === modelId; });
      if (existing) {
        existing.quantity += it.quantity;
      } else {
        itemsArray.push(Object.assign({}, it, { modelId: modelId, modelName: model.name }));
      }
    });

    if (blockBuilderModelIds.indexOf(modelId) === -1) {
      blockBuilderModelIds.push(modelId);
    }
    if (!document.getElementById("bloco-nome").value) {
      document.getElementById("bloco-nome").value = model.name;
    }
  }

  /** Agrupa uma lista de itens (com modelId/modelName) por comida de origem,
      mantendo o índice original de cada item em b.items (necessário para
      ações como marcar "falta"). Itens sem modelId caem em "Itens avulsos". */
  function groupItemsByModel(items) {
    var groups = {};
    var order = [];
    items.forEach(function (it, idx) {
      var key = it.modelId || "_avulso";
      if (!groups[key]) {
        groups[key] = { name: it.modelName || "Itens avulsos", items: [] };
        order.push(key);
      }
      groups[key].items.push(Object.assign({ idx: idx }, it));
    });
    return order.map(function (k) { return groups[k]; });
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

    db.collection("categories").orderBy("name").onSnapshot(function (snap) {
      var categories = [];
      snap.forEach(function (d) { categories.push(Object.assign({ id: d.id }, d.data())); });
      categoriesCache = categories;

      renderCategoriasFiltro();
      renderItens();
      fillItemSelect(document.getElementById("modelo-select-item"), "Selecione um item");
      fillItemSelect(document.getElementById("bloco-select-item"), "Selecione um item");
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

    var comprasBooted = false;
    db.collection("compras").orderBy("createdAt", "desc").onSnapshot(function (snap) {
      var compras = [];
      snap.forEach(function (d) { compras.push(Object.assign({ id: d.id }, d.data())); });
      comprasCache = compras;

      var notificar = !currentProfile || currentProfile.notifyCompras !== false;
      if (comprasBooted && notificar) {
        snap.docChanges().forEach(function (change) {
          if (change.type === "added" && change.doc.data().status === "pendente") {
            var c = change.doc.data();
            toast("⚠ Falta: " + c.itemName + (c.blockName ? " (" + c.blockName + ")" : ""));
          }
        });
      }
      comprasBooted = true;

      var temPendente = notificar && comprasCache.some(function (c) { return c.status === "pendente"; });
      document.getElementById("tab-badge-inicio").classList.toggle("hidden", !temPendente);

      renderCompras();
      renderCarrinho();
      renderDashboard();
    });

    db.collection("users").where("role", "==", "user").onSnapshot(function (snap) {
      var users = [];
      snap.forEach(function (d) { users.push(Object.assign({ id: d.id }, d.data())); });
      usersCache = users;

      var sel = document.getElementById("bloco-destinatario");
      var valorAtual = sel.value;
      sel.innerHTML = '<option value="">Selecione um usuário</option>' +
        users.map(function (u) { return '<option value="' + u.id + '">' + (u.name || u.id) + '</option>'; }).join("");
      sel.value = valorAtual;

      renderUsuarios();
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
    document.getElementById("m-despensa").textContent = comprasCache.filter(function (c) { return c.status === "pendente"; }).length;
    document.getElementById("m-carrinho").textContent = comprasCache.filter(function (c) { return c.status === "aprovado"; }).length;

    var recent = blocksCache.slice(0, 5);
    var container = document.getElementById("dashboard-recent");
    container.innerHTML = recent.length ? recent.map(function (b) {
      return '' +
        '<div class="list-row ' + b.status + '" data-id="' + b.id + '">' +
        '<div class="row-main">' +
        '<div class="row-title">' + b.name + '</div>' +
        '<div class="row-sub">Para ' + (b.assignedToName || "—") + ' · ' + fmtDate(b.createdAt) + '</div>' +
        '</div>' +
        '<div class="row-side">' + statusBadge(b.status) + '</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nenhuma lista ainda</h3><p>Crie a primeira lista na aba "Nova Lista".</p></div>';

    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openBlockDetail(row.dataset.id); });
    });
  }

  /* ============================================================
     ITENS
  ============================================================ */
  function renderItens() {
    var container = document.getElementById("lista-itens");
    var termo = itensSearchTerm.trim().toLowerCase();
    var itensFiltrados = itemsCache.filter(function (i) {
      var passaBusca = !termo ||
        i.name.toLowerCase().indexOf(termo) !== -1 ||
        (i.description || "").toLowerCase().indexOf(termo) !== -1;
      var passaCategoria = !itensCategoryFilter || i.categoryId === itensCategoryFilter;
      return passaBusca && passaCategoria;
    });

    container.innerHTML = itensFiltrados.length ? itensFiltrados.map(function (i) {
      return '' +
        '<div class="list-row" data-id="' + i.id + '">' +
        '<div class="row-main">' +
        '<div class="row-title">' + i.name + (i.categoryId ? ' <span class="small muted">— ' + categoryLabel(i.categoryId) + '</span>' : '') + '</div>' +
        '<div class="row-sub">' + (i.description || "Sem descrição") + '</div>' +
        '</div>' +
        '<div class="row-side">UNIDADE</div>' +
        '</div>';
    }).join("") : ((termo || itensCategoryFilter)
      ? '<div class="empty-state"><h3>Nenhum item encontrado</h3><p>Tente buscar por outro termo ou categoria.</p></div>'
      : '<div class="empty-state"><h3>Nenhum item cadastrado</h3><p>Cadastre o primeiro item para usar na comidas e listas.</p></div>');

    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openItemModal(row.dataset.id); });
    });
  }

  document.getElementById("busca-itens").addEventListener("input", function (e) {
    itensSearchTerm = e.target.value;
    renderItens();
  });

  /* ============================================================
     CATEGORIAS — filtro (chips) na tela de Itens + gestão (add/remover)
  ============================================================ */
  function renderCategoriasFiltro() {
    var container = document.getElementById("filtro-categorias");
    if (!container) return;

    var chips = '<span class="chip' + (itensCategoryFilter ? '' : ' active') + '" data-id="">Todas</span>' +
      categoriesCache.map(function (c) {
        return '<span class="chip' + (itensCategoryFilter === c.id ? ' active' : '') + '" data-id="' + c.id + '">' +
          c.name +
          '<span class="chip-remove" data-id="' + c.id + '" title="Remover categoria">×</span>' +
          '</span>';
      }).join("");

    container.innerHTML = chips || '<span class="small muted">Nenhuma categoria criada ainda.</span>';

    container.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        itensCategoryFilter = chip.dataset.id || "";
        renderCategoriasFiltro();
        renderItens();
      });
    });
    container.querySelectorAll(".chip-remove").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = btn.dataset.id;
        var cat = categoriesCache.find(function (c) { return c.id === id; });
        if (!cat) return;
        if (!confirm('Remover a categoria "' + cat.name + '"? Os itens dela ficarão sem categoria.')) return;
        db.collection("categories").doc(id).delete().then(function () {
          if (itensCategoryFilter === id) itensCategoryFilter = "";
          toast("Categoria removida.");
        }).catch(function () {
          toast("Erro ao remover categoria.");
        });
      });
    });
  }

  document.getElementById("btn-add-categoria").addEventListener("click", function () {
    var input = document.getElementById("nova-categoria-nome");
    var nome = input.value.trim();
    if (!nome) { toast("Digite o nome da categoria."); return; }
    var existe = categoriesCache.some(function (c) { return c.name.toLowerCase() === nome.toLowerCase(); });
    if (existe) { toast("Essa categoria já existe."); return; }

    db.collection("categories").add({
      name: nome,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      input.value = "";
      toast("Categoria criada.");
    }).catch(function () {
      toast("Erro ao criar categoria.");
    });
  });

  function openItemModal(id) {
    editingItemId = id || null;
    var item = id ? itemsCache.find(function (i) { return i.id === id; }) : null;
    document.getElementById("modal-item-titulo").textContent = item ? "Editar item" : "Novo item";
    document.getElementById("item-nome").value = item ? item.name : "";
    document.getElementById("item-descricao").value = item ? item.description || "" : "";
    fillItemCategorySelect(document.getElementById("item-categoria"), item ? item.categoryId || "" : "");
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
    var categoryId = document.getElementById("item-categoria").value || null;
    var categoryName = categoryId ? categoryLabel(categoryId) : null;
    if (!name) { toast("O nome do item é obrigatório."); return; }

    var payload = { name: name, description: description, categoryId: categoryId, categoryName: categoryName };
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
    if (!confirm("Desativar este item? Ele deixará de aparecer em novas comidas e listas.")) return;
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
    var sel = document.getElementById("bloco-select-modelo");
    sel.innerHTML = '<option value="">Selecione uma comida</option>' +
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
    if (!confirm("Excluir esta comida? listas já criadas a partir dela não serão afetadas.")) return;
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

  document.getElementById("btn-add-modelo-bloco").addEventListener("click", function () {
    var sel = document.getElementById("bloco-select-modelo");
    if (!sel.value) { toast("Selecione uma comida para adicionar."); return; }
    addModeloToBuilder(blockBuilderItems, sel.value);
    sel.value = "";
    renderBlocoBuilder();
  });

  document.getElementById("btn-add-item-bloco").addEventListener("click", function () {
    var sel = document.getElementById("bloco-select-item");
    addItemToBuilder(blockBuilderItems, sel.value);
    sel.value = "";
    renderBlocoBuilder();
  });

  function resetNovoBlocoForm() {
    editingBlockId = null;
    document.getElementById("novo-bloco-titulo").textContent = "Nova lista";
    document.getElementById("btn-enviar-bloco").textContent = "Criar e enviar lista";
    document.getElementById("bloco-nome").value = "";
    document.getElementById("bloco-descricao").value = "";
    document.getElementById("bloco-select-modelo").value = "";
    document.getElementById("bloco-destinatario").value = "";
    blockBuilderItems = [];
    blockBuilderModelIds = [];
    renderBlocoBuilder();
  }

  // Ao entrar em "Nova Lista" pelo menu lateral, sempre começa em branco —
  // só entra em modo de edição via o botão "Editar" no detalhe da lista.
  var novoBlocoNavItem = document.querySelector('.nav-item[data-view="novo-bloco"]');
  if (novoBlocoNavItem) novoBlocoNavItem.addEventListener("click", resetNovoBlocoForm);

  /** Abre a lista existente no mesmo formulário de "Nova Lista", pra editar
      e reenviar sem precisar apagar e recriar do zero. */
  function openBlockEditor(id) {
    var b = blocksCache.find(function (x) { return x.id === id; });
    if (!b) return;

    editingBlockId = id;
    document.getElementById("novo-bloco-titulo").textContent = "Editar lista";
    document.getElementById("btn-enviar-bloco").textContent = "Salvar e reenviar";
    document.getElementById("bloco-nome").value = b.name;
    document.getElementById("bloco-descricao").value = b.description || "";
    document.getElementById("bloco-destinatario").value = b.assignedTo || "";
    blockBuilderItems = b.items.map(function (i) { return Object.assign({}, i); });
    blockBuilderModelIds = (b.modelIds || []).slice();
    renderBlocoBuilder();
    switchView("novo-bloco");
  }

  document.getElementById("btn-enviar-bloco").addEventListener("click", function () {
    var name = document.getElementById("bloco-nome").value.trim();
    var description = document.getElementById("bloco-descricao").value.trim();
    var destSel = document.getElementById("bloco-destinatario");
    var assignedTo = destSel.value;
    var assignedToName = destSel.selectedOptions[0] ? destSel.selectedOptions[0].textContent : "";

    if (!name) { toast("Dê um nome a lista."); return; }
    if (!assignedTo) { toast("Selecione para quem enviar."); return; }
    if (blockBuilderItems.length === 0) { toast("Adicione pelo menos um item."); return; }

    var payload = {
      name: name,
      description: description,
      modelIds: blockBuilderModelIds, // comidas usadas para montar esta lista (apenas registro)
      assignedTo: assignedTo,
      assignedToName: assignedToName,
      items: blockBuilderItems,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    var promise = editingBlockId
      ? db.collection("blocks").doc(editingBlockId).update(Object.assign({}, payload, {
          status: STATUS.PENDENTE,
          flowRemoved: false
        }))
      : db.collection("blocks").add(Object.assign({}, payload, {
          status: STATUS.PENDENTE,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }));

    promise.then(function () {
      toast(editingBlockId ? "Lista atualizada e reenviada." : "Lista criada e enviada.");
      resetNovoBlocoForm();
      switchView("blocos");
    }).catch(function () {
      toast("Erro ao enviar lista.");
    });
  });

  /* ============================================================
     BLOCOS / HISTÓRICO (leitura + status)
  ============================================================ */
  function renderBlockRow(b) {
    var temFalta = b.items.some(function (i) { return i.falta; });
    return '' +
      '<div class="list-row ' + b.status + '" data-id="' + b.id + '">' +
      '<div class="row-main">' +
      '<div class="row-title">' + b.name + (temFalta ? ' <span class="warn-tag" title="Tem item faltando">' + ICON_WARN + ' Falta item</span>' : '') + '</div>' +
      '<div class="row-sub">Para ' + (b.assignedToName || "—") + ' · ' + b.items.length + ' itens · ' + fmtDate(b.createdAt) + '</div>' +
      '</div>' +
      '<div class="row-side">' + statusBadge(b.status) + '</div>' +
      '</div>';
  }

  function renderBlocos() {
    var ativos = blocksCache.filter(function (b) { return b.status !== STATUS.FINALIZADO && !b.flowRemoved; });
    var container = document.getElementById("lista-blocos");
    container.innerHTML = ativos.length ? ativos.map(renderBlockRow).join("")
      : '<div class="empty-state"><h3>Nenhuma lista em andamento</h3><p>As listas enviadas aparecerão aqui até serem finalizadas.</p></div>';
    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openBlockDetail(row.dataset.id); });
    });

    var removidas = blocksCache.filter(function (b) { return b.status !== STATUS.FINALIZADO && b.flowRemoved; });
    var secaoRemovidas = document.querySelector(".fora-fluxo-section");
    secaoRemovidas.classList.toggle("hidden", removidas.length === 0);
    var containerRemovidas = document.getElementById("lista-blocos-removidas");
    containerRemovidas.innerHTML = removidas.map(renderBlockRow).join("");
    containerRemovidas.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openBlockDetail(row.dataset.id); });
    });
  }

  function renderHistorico() {
    var finalizados = blocksCache.filter(function (b) { return b.status === STATUS.FINALIZADO; });
    var container = document.getElementById("lista-historico");
    container.innerHTML = finalizados.length ? finalizados.map(renderBlockRow).join("")
      : '<div class="empty-state"><h3>Nenhuma lista finalizada ainda</h3></div>';
    container.querySelectorAll(".list-row").forEach(function (row) {
      row.addEventListener("click", function () { openBlockDetail(row.dataset.id); });
    });
  }

  var currentDetailBlockId = null;

  function openBlockDetail(id) {
    var b = blocksCache.find(function (x) { return x.id === id; });
    if (!b) return;
    currentDetailBlockId = id;
    document.getElementById("detalhe-bloco-nome").textContent = b.name;
    document.getElementById("detalhe-bloco-destino").textContent = "Enviado para " + (b.assignedToName || "—") + " em " + fmtDate(b.createdAt);
    document.getElementById("detalhe-bloco-descricao").textContent = b.description || "";

    var grupos = groupItemsByModel(b.items);
    document.getElementById("detalhe-bloco-itens").innerHTML = grupos.map(function (g) {
      return '<div class="group-title">' + g.name + '</div>' +
        g.items.map(function (i) {
          return '<div class="item-line">' +
            '<span class="item-name">' + i.itemName + '</span>' +
            '<span class="small muted">' + i.quantity + ' un.</span>' +
            '<label class="small muted" style="display:flex;align-items:center;gap:6px;margin-left:10px;white-space:nowrap;">' +
            '<input type="checkbox" class="falta-check" data-idx="' + i.idx + '"' + (i.falta ? " checked" : "") + '> Falta' +
            '</label>' +
            '</div>';
        }).join("");
    }).join("");

    document.getElementById("detalhe-bloco-itens").querySelectorAll(".falta-check").forEach(function (chk) {
      chk.addEventListener("change", function () {
        adminToggleFalta(b, Number(chk.dataset.idx), chk.checked);
      });
    });

    document.getElementById("detalhe-bloco-status").outerHTML =
      statusBadge(b.status).replace('<span class="badge', '<span id="detalhe-bloco-status" class="badge');

    var podeEditar = b.status !== STATUS.FINALIZADO;
    document.getElementById("btn-editar-bloco").classList.toggle("hidden", !podeEditar);
    document.getElementById("btn-tirar-fluxo").classList.toggle("hidden", !podeEditar);
    document.getElementById("btn-tirar-fluxo").textContent = b.flowRemoved ? "Devolver ao fluxo" : "Tirar do fluxo";

    document.getElementById("modal-bloco").classList.add("active");
  }

  document.getElementById("btn-tirar-fluxo").addEventListener("click", function () {
    var b = blocksCache.find(function (x) { return x.id === currentDetailBlockId; });
    if (!b) return;
    var novoValor = !b.flowRemoved;
    db.collection("blocks").doc(b.id).update({ flowRemoved: novoValor }).then(function () {
      toast(novoValor ? "Lista tirada do fluxo." : "Lista devolvida ao fluxo.");
      document.getElementById("modal-bloco").classList.remove("active");
    });
  });

  document.getElementById("btn-editar-bloco").addEventListener("click", function () {
    document.getElementById("modal-bloco").classList.remove("active");
    openBlockEditor(currentDetailBlockId);
  });

  /** Admin marcando/desmarcando "falta" direto na lista — mesma mecânica
      do usuário: cria/remove o pedido correspondente em "compras". */
  function adminToggleFalta(block, idx, falta) {
    var item = block.items[idx];
    item.falta = falta;

    if (falta) {
      db.collection("compras").add({
        itemName: item.itemName,
        quantity: item.quantity,
        blockId: block.id,
        blockName: block.name,
        assignedTo: block.assignedTo,
        requestedBy: null,
        requestedByName: document.getElementById("user-name").textContent + " (admin)",
        status: "pendente",
        adminNote: "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function (ref) {
        item.compraId = ref.id;
        db.collection("blocks").doc(block.id).update({ items: block.items });
      }).catch(function (err) {
        console.error("Erro ao criar pedido de falta:", err);
        toast("Erro ao marcar falta (" + (err && err.code || "veja o console") + ").");
        item.falta = false; // desfaz visualmente já que não foi salvo
      });
    } else if (item.compraId) {
      db.collection("compras").doc(item.compraId).delete();
      delete item.compraId;
      db.collection("blocks").doc(block.id).update({ items: block.items });
    } else {
      db.collection("blocks").doc(block.id).update({ items: block.items });
    }
  }

  document.getElementById("btn-fechar-detalhe").addEventListener("click", function () {
    document.getElementById("modal-bloco").classList.remove("active");
  });

  /* ============================================================
     COMPRAS — itens marcados como "falta" pelos usuários
  ============================================================ */
  function renderCompras() {
    var container = document.getElementById("lista-compras");
    var pendentes = comprasCache.filter(function (c) { return c.status === "pendente"; });

    container.innerHTML = pendentes.length ? pendentes.map(function (c) {
      return '' +
        '<div class="list-row" data-id="' + c.id + '" style="cursor:default;">' +
        '<div class="row-main">' +
        '<div class="row-title">' + c.itemName + '</div>' +
        '<div class="row-sub">' + c.quantity + ' un. · ' + (c.blockName || "Item avulso") + ' · Pedido por ' + (c.requestedByName || "—") + '</div>' +
        (c.adminNote ? '<div class="row-sub">💡 ' + c.adminNote + '</div>' : '') +
        '</div>' +
        '<div class="row-side flex gap-2">' +
        '<button class="btn btn-ghost small btn-sugestao" data-id="' + c.id + '">' + (c.adminNote ? "Editar sugestão" : "Sugestão") + '</button>' +
        '<button class="btn btn-secondary small btn-aprovar" data-id="' + c.id + '">' + ICON_CHECK + ' Vai comprar</button>' +
        '<button class="btn btn-danger small btn-rejeitar" data-id="' + c.id + '">' + ICON_X + ' Não vai comprar</button>' +
        '</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nada pendente na despensa</h3></div>';

    container.querySelectorAll(".btn-aprovar").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        db.collection("compras").doc(btn.dataset.id).update({
          status: "aprovado",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          toast("Item foi para o carrinho.");
        });
      });
    });
    container.querySelectorAll(".btn-rejeitar").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        db.collection("compras").doc(btn.dataset.id).update({
          status: "rejeitado",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          toast("Item marcado como não comprado.");
        });
      });
    });
    container.querySelectorAll(".btn-sugestao").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var atual = comprasCache.find(function (c) { return c.id === btn.dataset.id; });
        var nota = prompt("Sugestão para quem vai comprar (ex.: onde encontrar, marca, etc.):", (atual && atual.adminNote) || "");
        if (nota === null) return;
        db.collection("compras").doc(btn.dataset.id).update({
          adminNote: nota.trim(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          toast("Sugestão salva.");
        });
      });
    });
  }

  /* ============================================================
     CARRINHO — itens já aprovados, prontos para comprar
     (mesma ideia da tela "Precisa comprar" do usuário, só que aqui
     o admin também pode marcar como já comprado)
  ============================================================ */
  function renderCarrinho() {
    var container = document.getElementById("lista-carrinho");
    var aprovados = comprasCache.filter(function (c) { return c.status === "aprovado"; });

    container.innerHTML = aprovados.length ? aprovados.map(function (c) {
      return '' +
        '<div class="list-row" data-id="' + c.id + '" style="cursor:default;">' +
        '<div class="row-main">' +
        '<div class="row-title">' + c.itemName + '</div>' +
        '<div class="row-sub">' + c.quantity + ' un. · ' + (c.blockName || "Item avulso") + '</div>' +
        (c.adminNote ? '<div class="row-sub">💡 ' + c.adminNote + '</div>' : '') +
        '</div>' +
        '<div class="row-side flex gap-2">' +
        '<button class="btn btn-ghost small btn-sugestao" data-id="' + c.id + '">' + (c.adminNote ? "Editar sugestão" : "Sugestão") + '</button>' +
        '<button class="btn btn-secondary small btn-comprado" data-id="' + c.id + '">' + ICON_CHECK + ' Comprado</button>' +
        '</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Carrinho vazio</h3><p>Itens aprovados na despensa aparecem aqui.</p></div>';

    container.querySelectorAll(".btn-comprado").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        db.collection("compras").doc(btn.dataset.id).update({
          status: "comprado",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          toast("Item marcado como comprado.");
        });
      });
    });
    container.querySelectorAll(".btn-sugestao").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var atual = comprasCache.find(function (c) { return c.id === btn.dataset.id; });
        var nota = prompt("Sugestão para quem vai comprar (ex.: onde encontrar, marca, etc.):", (atual && atual.adminNote) || "");
        if (nota === null) return;
        db.collection("compras").doc(btn.dataset.id).update({
          adminNote: nota.trim(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          toast("Sugestão salva.");
        });
      });
    });
  }

  /** Admin adicionando um item direto no carrinho, sem esperar pedido de
      um usuário — mesma mecânica usada pelo usuário, mas já entra como
      "aprovado" porque quem decidiu foi o próprio admin. */
  document.getElementById("btn-add-compra-admin").addEventListener("click", function () {
    var nome = document.getElementById("compra-admin-nome").value.trim();
    var qtd = Math.max(1, parseInt(document.getElementById("compra-admin-qtd").value, 10) || 1);
    if (!nome) { toast("Digite o nome do item."); return; }

    db.collection("compras").add({
      itemName: nome,
      quantity: qtd,
      blockId: null,
      blockName: null,
      requestedBy: null,
      requestedByName: document.getElementById("user-name").textContent + " (admin)",
      status: "aprovado",
      adminNote: "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      document.getElementById("compra-admin-nome").value = "";
      document.getElementById("compra-admin-qtd").value = "1";
      toast("Item adicionado ao carrinho.");
    }).catch(function (err) {
      console.error("Erro ao adicionar ao carrinho:", err);
      toast("Erro ao adicionar (" + (err && err.code || "veja o console") + ").");
    });
  });

  /* ============================================================
     PERFIL — meus dados, gestão de usuários, configurações, sobre
  ============================================================ */
  function renderPerfilHeader(user) {
    var nome = currentProfile.name || user.email;
    document.getElementById("perfil-avatar").textContent = nome.charAt(0).toUpperCase();
    document.getElementById("perfil-nome-atual").textContent = nome;
    document.getElementById("perfil-email-atual").textContent = user.email;
    document.getElementById("perfil-nome-input").value = currentProfile.name || "";
    document.getElementById("cfg-notify-compras").checked = currentProfile.notifyCompras !== false; // padrão: ligado
  }

  document.getElementById("btn-salvar-meu-nome").addEventListener("click", function () {
    var nome = document.getElementById("perfil-nome-input").value.trim();
    if (!nome) { toast("Digite um nome."); return; }
    db.collection("users").doc(auth.currentUser.uid).update({ name: nome }).then(function () {
      currentProfile.name = nome;
      document.getElementById("user-name").textContent = nome;
      document.getElementById("user-initial").textContent = nome.charAt(0).toUpperCase();
      renderPerfilHeader(auth.currentUser);
      toast("Nome atualizado.");
    }).catch(function () {
      toast("Erro ao salvar nome.");
    });
  });

  document.getElementById("cfg-notify-compras").addEventListener("change", function (e) {
    currentProfile.notifyCompras = e.target.checked;
    db.collection("users").doc(auth.currentUser.uid).update({ notifyCompras: e.target.checked }).catch(function () {
      toast("Erro ao salvar configuração.");
    });
  });

  /** Lista de usuários (role "user") pra o admin poder corrigir/editar o
      nome de quem tem acesso ao site do usuário. */
  function renderUsuarios() {
    var container = document.getElementById("lista-usuarios");
    if (!container) return;
    container.innerHTML = usersCache.length ? usersCache.map(function (u) {
      return '' +
        '<div class="list-row" style="cursor:default;" data-id="' + u.id + '">' +
        '<div class="row-main">' +
        '<div class="row-title">' + (u.name || "(sem nome)") + '</div>' +
        '<div class="row-sub">' + (u.email || u.id) + '</div>' +
        '</div>' +
        '<button class="btn btn-ghost small btn-editar-usuario" data-id="' + u.id + '">Editar nome</button>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nenhum usuário cadastrado ainda</h3></div>';

    container.querySelectorAll(".btn-editar-usuario").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var u = usersCache.find(function (x) { return x.id === btn.dataset.id; });
        if (!u) return;
        var novoNome = prompt("Nome de " + (u.email || u.id) + ":", u.name || "");
        if (novoNome === null) return;
        novoNome = novoNome.trim();
        if (!novoNome) { toast("O nome não pode ficar vazio."); return; }
        db.collection("users").doc(u.id).update({ name: novoNome }).then(function () {
          toast("Nome atualizado.");
        }).catch(function () {
          toast("Erro ao atualizar nome.");
        });
      });
    });
  }

  document.getElementById("btn-sair-perfil").addEventListener("click", function () {
    auth.signOut();
  });

  /* ---------- versão do app / aviso de atualização ---------- */
  document.getElementById("sobre-versao-atual").textContent = APP_VERSION;

  document.getElementById("btn-salvar-versao-admin").addEventListener("click", function () {
    var v = document.getElementById("sobre-versao-admin-input").value.trim();
    if (!v) { toast("Digite o número da versão."); return; }
    db.collection("config").doc("app").set({ latestVersionAdmin: v }, { merge: true }).then(function () {
      toast("Versão do admin publicada.");
    }).catch(function () {
      toast("Erro ao salvar versão.");
    });
  });

  document.getElementById("btn-salvar-versao-user").addEventListener("click", function () {
    var v = document.getElementById("sobre-versao-user-input").value.trim();
    if (!v) { toast("Digite o número da versão."); return; }
    db.collection("config").doc("app").set({ latestVersionUser: v }, { merge: true }).then(function () {
      toast("Versão do usuário publicada.");
    }).catch(function () {
      toast("Erro ao salvar versão.");
    });
  });

  document.getElementById("btn-atualizar-agora").addEventListener("click", function () {
    location.reload();
  });

  db.collection("config").doc("app").onSnapshot(function (snap) {
    var data = snap.exists ? snap.data() : {};
    document.getElementById("sobre-versao-admin-input").placeholder = data.latestVersionAdmin || "nenhuma publicada ainda";
    document.getElementById("sobre-versao-user-input").placeholder = data.latestVersionUser || "nenhuma publicada ainda";
    var desatualizado = !!data.latestVersionAdmin && data.latestVersionAdmin !== APP_VERSION;
    document.getElementById("update-banner").classList.toggle("hidden", !desatualizado);
  });

  /* ---------- barra de navegação inferior (mobile) ---------- */
  document.querySelectorAll(".tab-item[data-view]").forEach(function (el) {
    el.addEventListener("click", function () { switchView(el.dataset.view); });
  });

})();