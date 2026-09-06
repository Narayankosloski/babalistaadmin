/* ============================================================
   BABA LINDAO DEUS — USUÁRIO
   Arquivo único: config + inicialização + lógica.
   Usa o SDK clássico do Firebase (compat), carregado via <script>
   no HTML, por exemplo:

     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
     <script src="user.js"></script>

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

  // Sessão isolada por aba: evita que o site do admin (mesmo domínio
  // no GitHub Pages) derrube o login deste site do usuário, e vice-versa.
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

  var COMPRA_STATUS_LABEL = {
    pendente:  "Aguardando aprovação",
    aprovado:  "Aprovado para compra",
    rejeitado: "Não será comprado",
    comprado:  "Comprado"
  };

  var blocksCache = [];
  var comprasCache = [];
  var currentBlockId = null;
  var currentUid = null;

  /* ============================================================
     LOGIN / GUARD DE AUTENTICAÇÃO
  ============================================================ */
  var authShell    = document.getElementById("auth-shell");
  var appShell     = document.getElementById("app-shell");
  var authError    = document.getElementById("auth-error");
  var loginForm    = document.getElementById("login-form");
  var loginBtn     = document.getElementById("login-btn");
  var unsubscribeBlocks = null;
  var unsubscribeCompras = null;

  function showLogin(message) {
    if (unsubscribeBlocks) { unsubscribeBlocks(); unsubscribeBlocks = null; }
    if (unsubscribeCompras) { unsubscribeCompras(); unsubscribeCompras = null; }
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
    if (!user) { currentUid = null; showLogin(); return; }

    db.collection("users").doc(user.uid).get().then(function (snap) {
      var profile = snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;

      if (!profile || profile.role !== "user") {
        auth.signOut();
        showLogin("Esta conta não tem permissão de usuário.");
        return;
      }

      currentUid = user.uid;
      document.getElementById("user-name").textContent = profile.name || user.email;
      document.getElementById("user-initial").textContent = (profile.name || user.email).charAt(0).toUpperCase();

      showApp();

      if (unsubscribeBlocks) unsubscribeBlocks();
      unsubscribeBlocks = db.collection("blocks")
        .where("assignedTo", "==", user.uid)
        .orderBy("createdAt", "desc")
        .onSnapshot(function (snap2) {
          var blocks = [];
          snap2.forEach(function (d) { blocks.push(Object.assign({ id: d.id }, d.data())); });
          blocksCache = blocks;
          renderBlocos();
          renderHistorico();
        });

      if (unsubscribeCompras) unsubscribeCompras();
      unsubscribeCompras = db.collection("compras")
        .where("requestedBy", "==", user.uid)
        .orderBy("createdAt", "desc")
        .onSnapshot(function (snap3) {
          var compras = [];
          snap3.forEach(function (d) { compras.push(Object.assign({ id: d.id }, d.data())); });
          comprasCache = compras;
          renderComprar();
        });
    }).catch(function () {
      auth.signOut();
      showLogin("Erro ao verificar sua conta. Tente novamente.");
    });
  });

  document.getElementById("logout-btn").addEventListener("click", function () {
    auth.signOut();
  });

  /* ============================================================
     NAVEGAÇÃO + GAVETA LATERAL
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
    document.getElementById("view-" + name).classList.add("active");
    document.querySelector('.nav-item[data-view="' + name + '"]').classList.add("active");
  }
  document.querySelectorAll(".nav-item[data-view]").forEach(function (el) {
    el.addEventListener("click", function () { switchView(el.dataset.view); closeNav(); });
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
     HELPERS
  ============================================================ */
  function statusBadge(status) {
    return '<span class="badge ' + status + '">' + (STATUS_LABEL[status] || status) + '</span>';
  }
  function fmtDate(ts) {
    if (!ts || !ts.toDate) return "";
    return ts.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  /** Próximo status e o rótulo do botão de ação para avançar o fluxo. */
  function nextStep(status) {
    switch (status) {
      case STATUS.PENDENTE:  return { next: STATUS.ACEITO,     label: "Aceitar" };
      case STATUS.ACEITO:    return { next: STATUS.ANDAMENTO,  label: "Iniciar produção" };
      case STATUS.ANDAMENTO: return { next: STATUS.FINALIZADO, label: "Finalizar" };
      default:                return null;
    }
  }

  /* ============================================================
     RENDER — BLOCOS
  ============================================================ */
  function renderBlockRow(b) {
    return '' +
      '<div class="list-row ' + b.status + '" data-id="' + b.id + '">' +
      '<div class="row-main">' +
      '<div class="row-title">' + b.name + '</div>' +
      '<div class="row-sub">' + b.items.length + ' ' + (b.items.length === 1 ? "item" : "itens") + ' · ' + fmtDate(b.createdAt) + '</div>' +
      '</div>' +
      '<div class="row-side">' + statusBadge(b.status) + '</div>' +
      '</div>';
  }

  function renderBlocos() {
    var ativos = blocksCache.filter(function (b) { return b.status !== STATUS.FINALIZADO; });
    var container = document.getElementById("lista-blocos");
    container.innerHTML = ativos.length ? ativos.map(renderBlockRow).join("")
      : '<div class="empty-state"><h3>Nenhum bloco no momento</h3><p>Quando o administrador enviar uma tarefa, ela aparecerá aqui.</p></div>';
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

  /* ============================================================
     MODAL DE DETALHE + AÇÃO DE STATUS
  ============================================================ */
  function openBlockDetail(id) {
    var b = blocksCache.find(function (x) { return x.id === id; });
    if (!b) return;
    currentBlockId = id;

    document.getElementById("detalhe-bloco-nome").textContent = b.name;
    document.getElementById("detalhe-bloco-descricao").textContent = b.description || "Sem descrição adicional.";

    document.getElementById("detalhe-bloco-itens").innerHTML = b.items.map(function (i, idx) {
      return '<div class="item-line">' +
        '<span class="item-name">' + i.itemName + '</span>' +
        '<span class="small muted">' + i.quantity + ' un.</span>' +
        '<label class="small muted" style="display:flex;align-items:center;gap:6px;margin-left:10px;white-space:nowrap;">' +
        '<input type="checkbox" class="falta-check" data-idx="' + idx + '"' + (i.falta ? " checked" : "") + '> Falta' +
        '</label>' +
        '</div>';
    }).join("");

    document.getElementById("detalhe-bloco-itens").querySelectorAll(".falta-check").forEach(function (chk) {
      chk.addEventListener("change", function () {
        toggleFalta(b, Number(chk.dataset.idx), chk.checked);
      });
    });

    document.getElementById("detalhe-bloco-status").outerHTML =
      statusBadge(b.status).replace('<span class="badge', '<span id="detalhe-bloco-status" class="badge');

    var actionBtn = document.getElementById("btn-avancar-status");
    var step = nextStep(b.status);
    if (step) {
      actionBtn.textContent = step.label;
      actionBtn.classList.remove("hidden");
      actionBtn.onclick = function () {
        db.collection("blocks").doc(b.id).update({
          status: step.next,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          toast('Bloco marcado como "' + STATUS_LABEL[step.next] + '".');
          document.getElementById("modal-bloco").classList.remove("active");
        });
      };
    } else {
      actionBtn.classList.add("hidden");
    }

    document.getElementById("modal-bloco").classList.add("active");
  }

  /* ============================================================
     PRECISA COMPRAR — marcar item como faltando + itens avulsos
  ============================================================ */

  /** Marca/desmarca "falta" num item do bloco e sincroniza com a
      coleção "compras", que alimenta a aba "Precisa comprar" e o
      painel de compras do admin. */
  function toggleFalta(block, idx, falta) {
    var item = block.items[idx];
    item.falta = falta;

    if (falta) {
      db.collection("compras").add({
        itemName: item.itemName,
        quantity: item.quantity,
        blockId: block.id,
        blockName: block.name,
        requestedBy: currentUid,
        requestedByName: document.getElementById("user-name").textContent,
        status: "pendente",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function (ref) {
        item.compraId = ref.id;
        db.collection("blocks").doc(block.id).update({ items: block.items });
      });
    } else if (item.compraId) {
      db.collection("compras").doc(item.compraId).delete();
      delete item.compraId;
      db.collection("blocks").doc(block.id).update({ items: block.items });
    } else {
      db.collection("blocks").doc(block.id).update({ items: block.items });
    }
  }

  function renderComprar() {
    var container = document.getElementById("lista-comprar");
    container.innerHTML = comprasCache.length ? comprasCache.map(function (c) {
      return '<div class="list-row">' +
        '<div class="row-main">' +
        '<div class="row-title">' + c.itemName + '</div>' +
        '<div class="row-sub">' + c.quantity + ' un. · ' + (c.blockName || "Item avulso") + '</div>' +
        '</div>' +
        '<div class="row-side">' + (COMPRA_STATUS_LABEL[c.status] || c.status) + '</div>' +
        '</div>';
    }).join("") : '<div class="empty-state"><h3>Nenhum item pendente</h3><p>Itens marcados como "Falta" aparecerão aqui.</p></div>';
  }

  document.getElementById("btn-add-comprar").addEventListener("click", function () {
    var nome = document.getElementById("comprar-nome").value.trim();
    var qtd = Math.max(1, parseInt(document.getElementById("comprar-qtd").value, 10) || 1);
    if (!nome) { toast("Digite o nome do item."); return; }

    db.collection("compras").add({
      itemName: nome,
      quantity: qtd,
      blockId: null,
      blockName: null,
      requestedBy: currentUid,
      requestedByName: document.getElementById("user-name").textContent,
      status: "pendente",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      document.getElementById("comprar-nome").value = "";
      document.getElementById("comprar-qtd").value = "1";
      toast("Item adicionado à lista de compras.");
    });
  });

  document.getElementById("btn-fechar-detalhe").addEventListener("click", function () {
    document.getElementById("modal-bloco").classList.remove("active");
  });

})();