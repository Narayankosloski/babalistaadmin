import {
  auth, watchAuth, getUserProfile, logout,
  watchItems, createItem, updateItem, deactivateItem,
  watchModels, createModel, updateModel, deleteModel, getModel,
  watchAllBlocks, createBlock,
  listUsersByRole,
  STATUS, STATUS_LABEL
} from "./firebase.js";

/* ============================================================
   ESTADO
============================================================ */
let itemsCache  = [];
let modelsCache = [];
let blocksCache = [];
let usersCache  = [];

let editingItemId  = null;
let editingModelId = null;   // null = novo modelo
let modelBuilderItems = [];  // itens sendo editados no editor de modelo
let blockBuilderItems = [];  // itens sendo montados no Novo Bloco

/* ============================================================
   GUARD DE AUTENTICAÇÃO
============================================================ */
watchAuth(async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  const profile = await getUserProfile(user.uid);
  if (!profile || profile.role !== "admin") {
    window.location.href = profile && profile.role === "user" ? "user.html" : "index.html";
    return;
  }
  document.getElementById("user-name").textContent = profile.name || user.email;
  document.getElementById("user-initial").textContent = (profile.name || user.email).charAt(0).toUpperCase();

  boot();
});

document.getElementById("logout-btn").addEventListener("click", () => logout());

/* ============================================================
   NAVEGAÇÃO ENTRE VIEWS
============================================================ */
function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (nav) nav.classList.add("active");
}

document.querySelectorAll(".nav-item[data-view]").forEach(el => {
  el.addEventListener("click", () => switchView(el.dataset.view));
});

/* ============================================================
   TOAST
============================================================ */
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ============================================================
   HELPERS DE UI COMPARTILHADOS
============================================================ */
function statusBadge(status) {
  return `<span class="badge ${status}">${STATUS_LABEL[status] || status}</span>`;
}

function fmtDate(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Renderiza a lista editável de itens de um modelo/bloco em construção. */
function renderBuilderItems(containerId, itemsArray, onChange) {
  const container = document.getElementById(containerId);
  if (itemsArray.length === 0) {
    container.innerHTML = `<p class="muted small">Nenhum item adicionado ainda.</p>`;
    return;
  }
  container.innerHTML = itemsArray.map((it, idx) => `
    <div class="item-line">
      <span class="item-name">${it.itemName}</span>
      <input type="number" min="1" class="qty-input" data-idx="${idx}" value="${it.quantity}">
      <span class="small muted">un.</span>
      <span class="remove" data-idx="${idx}" style="cursor:pointer;">Remover</span>
    </div>
  `).join("");

  container.querySelectorAll(".qty-input").forEach(inp => {
    inp.addEventListener("change", () => {
      const idx = Number(inp.dataset.idx);
      const val = Math.max(1, parseInt(inp.value, 10) || 1);
      itemsArray[idx].quantity = val;
      inp.value = val;
    });
  });
  container.querySelectorAll(".remove").forEach(btn => {
    btn.addEventListener("click", () => {
      itemsArray.splice(Number(btn.dataset.idx), 1);
      onChange();
    });
  });
}

function fillItemSelect(selectEl, placeholder) {
  selectEl.innerHTML = `<option value="">${placeholder}</option>` +
    itemsCache.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
}

function addItemToBuilder(itemsArray, itemId) {
  if (!itemId) return;
  const item = itemsCache.find(i => i.id === itemId);
  if (!item) return;
  const existing = itemsArray.find(i => i.itemId === itemId);
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
  watchItems(items => {
    itemsCache = items;
    renderItens();
    fillItemSelect(document.getElementById("modelo-select-item"), "Selecione um item");
    fillItemSelect(document.getElementById("bloco-select-item"), "Selecione um item");
    renderDashboard();
  });

  watchModels(models => {
    modelsCache = models;
    renderModelos();
    fillModeloSelectNoBloco();
    renderDashboard();
  });

  watchAllBlocks(blocks => {
    blocksCache = blocks;
    renderBlocos();
    renderHistorico();
    renderDashboard();
  });

  listUsersByRole("user").then(users => {
    usersCache = users;
    const sel = document.getElementById("bloco-destinatario");
    sel.innerHTML = `<option value="">Selecione um usuário</option>` +
      users.map(u => `<option value="${u.id}">${u.name || u.id}</option>`).join("");
  });
}

/* ============================================================
   DASHBOARD
============================================================ */
function renderDashboard() {
  document.getElementById("m-itens").textContent = itemsCache.length;
  document.getElementById("m-modelos").textContent = modelsCache.length;
  document.getElementById("m-pendentes").textContent = blocksCache.filter(b => b.status === STATUS.PENDENTE).length;
  document.getElementById("m-andamento").textContent = blocksCache.filter(b => b.status === STATUS.ACEITO || b.status === STATUS.ANDAMENTO).length;
  document.getElementById("m-finalizados").textContent = blocksCache.filter(b => b.status === STATUS.FINALIZADO).length;

  const recent = blocksCache.slice(0, 5);
  const container = document.getElementById("dashboard-recent");
  container.innerHTML = recent.length ? recent.map(b => `
    <div class="list-row ${b.status}">
      <div class="row-main">
        <div class="row-title">${b.name}</div>
        <div class="row-sub">Para ${b.assignedToName || "—"} · ${fmtDate(b.createdAt)}</div>
      </div>
      <div class="row-side">${statusBadge(b.status)}</div>
    </div>
  `).join("") : `<div class="empty-state"><h3>Nenhum bloco ainda</h3><p>Crie o primeiro bloco na aba "Novo Bloco".</p></div>`;
}

/* ============================================================
   ITENS
============================================================ */
function renderItens() {
  const container = document.getElementById("lista-itens");
  container.innerHTML = itemsCache.length ? itemsCache.map(i => `
    <div class="list-row" data-id="${i.id}">
      <div class="row-main">
        <div class="row-title">${i.name}</div>
        <div class="row-sub">${i.description || "Sem descrição"}</div>
      </div>
      <div class="row-side">UNIDADE</div>
    </div>
  `).join("") : `<div class="empty-state"><h3>Nenhum item cadastrado</h3><p>Cadastre o primeiro item para usar em modelos e blocos.</p></div>`;

  container.querySelectorAll(".list-row").forEach(row => {
    row.addEventListener("click", () => openItemModal(row.dataset.id));
  });
}

function openItemModal(id) {
  editingItemId = id || null;
  const item = id ? itemsCache.find(i => i.id === id) : null;
  document.getElementById("modal-item-titulo").textContent = item ? "Editar item" : "Novo item";
  document.getElementById("item-nome").value = item ? item.name : "";
  document.getElementById("item-descricao").value = item ? item.description || "" : "";
  document.getElementById("btn-desativar-item").classList.toggle("hidden", !item);
  document.getElementById("modal-item").classList.add("active");
}

document.getElementById("btn-novo-item").addEventListener("click", () => openItemModal(null));
document.getElementById("btn-cancelar-item").addEventListener("click", () => document.getElementById("modal-item").classList.remove("active"));

document.getElementById("btn-salvar-item").addEventListener("click", async () => {
  const name = document.getElementById("item-nome").value.trim();
  const description = document.getElementById("item-descricao").value.trim();
  if (!name) { toast("O nome do item é obrigatório."); return; }

  try {
    if (editingItemId) {
      await updateItem(editingItemId, { name, description });
      toast("Item atualizado.");
    } else {
      await createItem({ name, description });
      toast("Item cadastrado.");
    }
    document.getElementById("modal-item").classList.remove("active");
  } catch (err) {
    toast("Erro ao salvar item.");
  }
});

document.getElementById("btn-desativar-item").addEventListener("click", async () => {
  if (!editingItemId) return;
  if (!confirm("Desativar este item? Ele deixará de aparecer em novos modelos e blocos.")) return;
  await deactivateItem(editingItemId);
  toast("Item desativado.");
  document.getElementById("modal-item").classList.remove("active");
});

/* ============================================================
   MODELOS
============================================================ */
function renderModelos() {
  const container = document.getElementById("lista-modelos");
  container.innerHTML = modelsCache.length ? modelsCache.map(m => `
    <div class="list-row" data-id="${m.id}">
      <div class="row-main">
        <div class="row-title">${m.name}</div>
        <div class="row-sub">${(m.description || "Sem descrição")}</div>
      </div>
      <div class="row-side">${m.items.length} ${m.items.length === 1 ? "item" : "itens"}</div>
    </div>
  `).join("") : `<div class="empty-state"><h3>Nenhum modelo cadastrado</h3><p>Crie um modelo para reutilizar conjuntos de itens.</p></div>`;

  container.querySelectorAll(".list-row").forEach(row => {
    row.addEventListener("click", () => openModelEditor(row.dataset.id));
  });
}

function fillModeloSelectNoBloco() {
  const sel = document.getElementById("bloco-usar-modelo");
  sel.innerHTML = `<option value="">— Começar vazio —</option>` +
    modelsCache.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
}

async function openModelEditor(id) {
  editingModelId = id || null;
  const model = id ? await getModel(id) : null;

  document.getElementById("editor-modelo-titulo").textContent = model ? model.name : "Novo modelo";
  document.getElementById("modelo-nome").value = model ? model.name : "";
  document.getElementById("modelo-descricao").value = model ? (model.description || "") : "";
  document.getElementById("btn-excluir-modelo").classList.toggle("hidden", !model);

  // cópia local — não afeta o modelo original até "Salvar modelo"
  modelBuilderItems = model ? model.items.map(i => ({ ...i })) : [];
  renderModeloBuilder();
  switchView("editor-modelo");
}

function renderModeloBuilder() {
  renderBuilderItems("modelo-itens-lista", modelBuilderItems, renderModeloBuilder);
}

document.getElementById("btn-novo-modelo").addEventListener("click", () => openModelEditor(null));
document.getElementById("btn-cancelar-modelo").addEventListener("click", () => switchView("modelos"));

document.getElementById("btn-add-item-modelo").addEventListener("click", () => {
  const sel = document.getElementById("modelo-select-item");
  addItemToBuilder(modelBuilderItems, sel.value);
  sel.value = "";
  renderModeloBuilder();
});

document.getElementById("btn-salvar-modelo").addEventListener("click", async () => {
  const name = document.getElementById("modelo-nome").value.trim();
  const description = document.getElementById("modelo-descricao").value.trim();
  if (!name) { toast("O nome do modelo é obrigatório."); return; }

  const payload = { name, description, items: modelBuilderItems };
  try {
    if (editingModelId) {
      await updateModel(editingModelId, payload);
      toast("Modelo atualizado.");
    } else {
      await createModel(payload);
      toast("Modelo criado.");
    }
    switchView("modelos");
  } catch (err) {
    toast("Erro ao salvar modelo.");
  }
});

document.getElementById("btn-excluir-modelo").addEventListener("click", async () => {
  if (!editingModelId) return;
  if (!confirm("Excluir este modelo? Blocos já criados a partir dele não serão afetados.")) return;
  await deleteModel(editingModelId);
  toast("Modelo excluído.");
  switchView("modelos");
});

/* ============================================================
   NOVO BLOCO
============================================================ */
function renderBlocoBuilder() {
  renderBuilderItems("bloco-itens-lista", blockBuilderItems, renderBlocoBuilder);
}

document.getElementById("bloco-usar-modelo").addEventListener("change", (e) => {
  const modelId = e.target.value;
  if (!modelId) { blockBuilderItems = []; renderBlocoBuilder(); return; }
  const model = modelsCache.find(m => m.id === modelId);
  if (!model) return;
  // cópia independente — editar aqui nunca altera o modelo original
  blockBuilderItems = model.items.map(i => ({ ...i }));
  if (!document.getElementById("bloco-nome").value) {
    document.getElementById("bloco-nome").value = model.name;
  }
  renderBlocoBuilder();
});

document.getElementById("btn-add-item-bloco").addEventListener("click", () => {
  const sel = document.getElementById("bloco-select-item");
  addItemToBuilder(blockBuilderItems, sel.value);
  sel.value = "";
  renderBlocoBuilder();
});

document.getElementById("btn-enviar-bloco").addEventListener("click", async () => {
  const name = document.getElementById("bloco-nome").value.trim();
  const description = document.getElementById("bloco-descricao").value.trim();
  const destSel = document.getElementById("bloco-destinatario");
  const assignedTo = destSel.value;
  const assignedToName = destSel.selectedOptions[0] ? destSel.selectedOptions[0].textContent : "";
  const modelId = document.getElementById("bloco-usar-modelo").value || null;

  if (!name) { toast("Dê um nome ao bloco."); return; }
  if (!assignedTo) { toast("Selecione para quem enviar."); return; }
  if (blockBuilderItems.length === 0) { toast("Adicione pelo menos um item."); return; }

  try {
    await createBlock({ name, description, modelId, assignedTo, assignedToName, items: blockBuilderItems });
    toast("Bloco criado e enviado.");
    document.getElementById("bloco-nome").value = "";
    document.getElementById("bloco-descricao").value = "";
    document.getElementById("bloco-usar-modelo").value = "";
    destSel.value = "";
    blockBuilderItems = [];
    renderBlocoBuilder();
    switchView("blocos");
  } catch (err) {
    toast("Erro ao enviar bloco.");
  }
});

/* ============================================================
   BLOCOS / HISTÓRICO (leitura + status)
============================================================ */
function renderBlockRow(b) {
  return `
    <div class="list-row ${b.status}" data-id="${b.id}">
      <div class="row-main">
        <div class="row-title">${b.name}</div>
        <div class="row-sub">Para ${b.assignedToName || "—"} · ${b.items.length} itens · ${fmtDate(b.createdAt)}</div>
      </div>
      <div class="row-side">${statusBadge(b.status)}</div>
    </div>`;
}

function renderBlocos() {
  const ativos = blocksCache.filter(b => b.status !== STATUS.FINALIZADO);
  const container = document.getElementById("lista-blocos");
  container.innerHTML = ativos.length ? ativos.map(renderBlockRow).join("")
    : `<div class="empty-state"><h3>Nenhum bloco em andamento</h3><p>Os blocos enviados aparecerão aqui até serem finalizados.</p></div>`;
  container.querySelectorAll(".list-row").forEach(row => row.addEventListener("click", () => openBlockDetail(row.dataset.id)));
}

function renderHistorico() {
  const finalizados = blocksCache.filter(b => b.status === STATUS.FINALIZADO);
  const container = document.getElementById("lista-historico");
  container.innerHTML = finalizados.length ? finalizados.map(renderBlockRow).join("")
    : `<div class="empty-state"><h3>Nenhum bloco finalizado ainda</h3></div>`;
  container.querySelectorAll(".list-row").forEach(row => row.addEventListener("click", () => openBlockDetail(row.dataset.id)));
}

function openBlockDetail(id) {
  const b = blocksCache.find(x => x.id === id);
  if (!b) return;
  document.getElementById("detalhe-bloco-nome").textContent = b.name;
  document.getElementById("detalhe-bloco-destino").textContent = `Enviado para ${b.assignedToName || "—"} em ${fmtDate(b.createdAt)}`;
  document.getElementById("detalhe-bloco-descricao").textContent = b.description || "";
  document.getElementById("detalhe-bloco-itens").innerHTML = b.items.map(i => `
    <div class="item-line"><span class="item-name">${i.itemName}</span><span class="small muted">${i.quantity} un.</span></div>
  `).join("");
  document.getElementById("detalhe-bloco-status").outerHTML = statusBadge(b.status).replace("<span class=\"badge", `<span id="detalhe-bloco-status" class="badge`);
  document.getElementById("modal-bloco").classList.add("active");
}

document.getElementById("btn-fechar-detalhe").addEventListener("click", () => document.getElementById("modal-bloco").classList.remove("active"));
