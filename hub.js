import { clearGameData, confirmGameDeletion } from './delete-game.js?v=20261013-account-saves-1';
import { formatClearScore } from './game-progress.js?v=20261012-reset-1';
import { library, playable } from './catalog.js?v=20261022-tunes-covers-1';
import { read, write, readText, writeText, counters, trackLaunch, accountSaveStatus } from './storage.js?v=20261013-account-saves-1';
import { account, accountError, initializeAccount, request, accountLink, mergePersonalBests } from './auth.js?v=20261013-account-saves-1';
import { initSoundtrack } from './music.js?v=20261005-loader-1';
import { formatMineNumber } from '/games/drafts/games/mine-format.js?v=20261005-loader-1';
import { formatMiles } from '/games/open-trails/distance.js?v=20261021-lifetime-2';

await initializeAccount();
await window.HHDevice?.ready;

let removalState = { games: [], needed: 5 };
let removedGameIds = new Set();
try {
  const response = await fetch('/api/removal-votes', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (response.ok) {
    removalState = await response.json();
    removedGameIds = new Set((Array.isArray(removalState.games) ? removalState.games : []).filter(game => game.vote && game.vote.status === 'passed').map(game => game.id));
  }
} catch { /* Leave published games visible when the vote list cannot be loaded. */ }
const listed = games => games.filter(game => !removedGameIds.has(game.id));

const query = selector => document.querySelector(selector);
const validIds = new Set(library.map(game => game.id));
const storedFavorites = read('hh-favorites', []);
const favorites = new Set((Array.isArray(storedFavorites) ? storedFavorites : []).filter(id => validIds.has(id)));
let category = 'All';
let toastTimer;
const dialog = query('#panel');
const format = value => new Intl.NumberFormat().format(value);
const formatScore = (game, value) => game.id === 'open-trails' ? formatMiles(value, 2) : game.key === 'ultra' ? formatClearScore(value) : (game.key === 'whip' || game.id === 'idle-mining-empire') ? formatMineNumber(value) : format(value);
const soundtrack = initSoundtrack();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notify(message) {
  query('#toast').textContent = message;
  query('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => query('#toast').classList.remove('show'), 3500);
}

function gameLink(game, className, title) {
  const link = element('a', className, title);
  link.href = game.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', game.native ? `Open ${game.title} details (desktop game, new tab)` : `Play ${game.title} (opens in a new tab)`);
  link.dataset.launch = game.id;
  return link;
}

function card(game, bests, plays) {
  const article = element('article', 'game-card');
  article.style.setProperty('--game-accent', game.accent);
  article.dataset.game = game.id;
  const art = gameLink(game, 'game-art');
  if (game.cover) {
    const image = element('img');
    Object.assign(image, { src: game.cover, alt: '', loading: 'lazy', decoding: 'async', width: 960, height: 600 });
    art.append(image);
  } else art.append(element('span', 'art-symbol', game.symbol));
  const favorite = element('button', 'favorite-btn', favorites.has(game.id) ? '★' : '☆');
  favorite.setAttribute('aria-label', `Favorite ${game.title}`);
  favorite.setAttribute('aria-pressed', String(favorites.has(game.id)));
  favorite.onclick = () => {
    favorites.has(game.id) ? favorites.delete(game.id) : favorites.add(game.id);
    write('hh-favorites', [...favorites]);
    render();
    query(`[data-game="${game.id}"] .favorite-btn`)?.focus();
  };
  const body = element('div', 'game-body');
  const titleRow = element('div', 'game-title-row');
  titleRow.append(element('h3', '', game.title), element('span', 'genre', game.genre));
  const bottom = element('div', 'game-bottom');
  const actions = element('div', 'game-actions');
  if (game.tag) {
    const tag = element('span', `game-tag game-tag-${game.tag.row}`, game.tag.label);
    actions.append(tag);
  }
  actions.append(gameLink(game, 'play-btn', game.native ? 'Open ↗' : 'Play ↗'));
  bottom.append(element('small', '', cardStatus(game, bests, plays)), actions);
  body.append(titleRow, element('p', 'game-description', game.note), bottom);
  article.append(art, favorite, body);
  return article;
}

function cardStatus(game, bests, plays) {
  if (game.native) return 'Linux desktop';
  const best = bests[game.id] || 0;
  const launches = plays[game.id] || 0;
  if (game.id === 'open-trails' && best) return `Lifetime: ${formatScore(game, best)} miles`;
  return best ? `Best: ${formatScore(game, best)} ${(game.metric || 'points').toLowerCase()}` : launches ? `${format(launches)} ${launches === 1 ? 'play' : 'plays'}` : game.metric ? 'No score yet' : 'Browser game';
}

const gameCards = new Map();
const emptyState = element('div', 'empty');
query('#gamesGrid').append(emptyState);
let matchingGames = [];

function render() {
  const term = query('#searchInput').value.trim().toLowerCase();
  const visibleLibrary = listed(library);
  const visiblePlayable = listed(playable);
  const matches = visibleLibrary.filter(game => (category === 'All' || category === game.genre) && `${game.title} ${game.genre} ${game.aliases || ''}`.toLowerCase().includes(term));
  const plays = counters('hh-plays');
  const bests = counters('hh-records');
  const ordered = [...visiblePlayable];
  ordered.sort((first, second) => {
    const favoriteOrder = Number(favorites.has(second.id)) - Number(favorites.has(first.id));
    if (favoriteOrder) return favoriteOrder;
    const categoryOrder = (first.tag?.row ?? 4) - (second.tag?.row ?? 4);
    if (categoryOrder) return categoryOrder;
    if (query('#sortSelect').value === 'title') return first.title.localeCompare(second.title);
    if (query('#sortSelect').value === 'played') return (plays[second.id] || 0) - (plays[first.id] || 0);
    return 0;
  });
  const matchingIds = new Set(matches.map(game => game.id));
  const ready = ordered.filter(game => matchingIds.has(game.id));
  matchingGames = ready;
  query('#randomBtn').disabled = ready.length === 0;
  query('#randomBtn').title = ready.length ? 'Pick from the games matching your filters' : 'No games match these filters';
  const grid = query('#gamesGrid');
  // Keep the same cards and decoded images while changing filters.
  ordered.forEach((game, index) => {
    let article = gameCards.get(game.id);
    if (!article) { article = card(game, bests, plays); gameCards.set(game.id, article); }
    if (grid.children[index] !== article) grid.insertBefore(article, grid.children[index] || null);
    article.hidden = !matchingIds.has(game.id);
    const favorite = article.querySelector('.favorite-btn');
    favorite.textContent = favorites.has(game.id) ? '★' : '☆';
    favorite.setAttribute('aria-pressed', String(favorites.has(game.id)));
    article.querySelector('.game-bottom small').textContent = cardStatus(game, bests, plays);
  });
  emptyState.hidden = ready.length > 0;
  emptyState.textContent = 'No playable games match. Try another search or clear your filters.';
  const planned = matches.filter(game => !game.url);
  query('#plannedSection').hidden = !planned.length;
  query('#plannedCount').textContent = `· ${planned.length} titles`;
  query('#plannedGrid').replaceChildren(...planned.map(game => {
    const row = element('article', 'planned-game');
    const body = element('div', 'planned-body');
    const meta = element('div', 'planned-meta');
    meta.append(element('span', '', game.genre), element('span', 'availability', 'Not installed'));
    body.append(element('h3', '', game.title), meta);
    row.append(body);
    return row;
  }));
  if (term && planned.length) query('#plannedSection').open = true;
  query('#gameCount').textContent = `${ready.length} playable ${ready.length === 1 ? 'game' : 'games'}`;
  query('#gameTotal').textContent = visiblePlayable.length;
  query('#playTotal').textContent = format(visiblePlayable.reduce((total, game) => total + (plays[game.id] || 0), 0));
  for (const button of document.querySelectorAll('.category-btn')) {
    button.classList.toggle('active', button.textContent === category);
    button.setAttribute('aria-pressed', String(button.textContent === category));
  }
}

function openPanel(title, content) {
  query('#panelTitle').textContent = title;
  query('#panelBody').replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}

function applySettings() {
  document.body.classList.toggle('compact', readText('hh-compact') === 'true');
  document.body.classList.toggle('reduce-motion', readText('hh-reduce-motion') === 'true');
  const theme = readText('hh-theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f3ef' : '#181b1a');
  document.querySelectorAll('input[data-preference]').forEach(checkbox => {
    const key = checkbox.dataset.preference;
    checkbox.checked = key === 'hh-theme' ? theme === 'light' : readText(key) === 'true';
  });
  const name = account?.nickname;
  query('#profileBtn').textContent = name ? name.charAt(0).toUpperCase() : '↗';
  query('#profileBtn').setAttribute('aria-label', name ? `Account: ${name}` : 'Sign up or sign in');
  query('#accountMessage').textContent = accountError || (name ? `Signed in as ${name}.` : 'Sign in to play and save scores.');
  query('#accountLink').textContent = name ? 'Player profile' : 'Sign in / Create account';
  for(const link of document.querySelectorAll('[data-admin-link]')) link.hidden = !account?.isAdmin;
  query('#retryConnection').hidden = !accountError;
}

function settings() {
  const content = element('div');
  const deviceRow = element('div', 'setting-row');
  const deviceText = element('span', '', 'Game controls');
  deviceText.append(element('small', '', 'Choose Mobile for touch controls or PC for keyboard and mouse. This choice stays with this browser.'));
  const deviceButton = element('button', 'secondary-btn', 'Change controls');
  deviceButton.type = 'button';
  deviceButton.onclick = () => window.HHDevice?.open();
  deviceRow.append(deviceText, deviceButton); content.append(deviceRow);
  for (const [key, title, detail] of [['hh-theme', 'Light mode', 'Use a light palette across HaywardHub.'], ['hh-compact', 'Compact cards', 'Fit more games into your library.'], ['hh-disguise', 'Disguise mode', 'Show Clever’s name and logo in this browser tab.']]) {
    const label = element('label', 'setting-row');
    const text = element('span', '', title);
    text.append(element('small', '', detail));
    const checkbox = element('input');
    checkbox.type = 'checkbox'; checkbox.dataset.preference = key;
    checkbox.checked = key === 'hh-theme' ? readText(key) === 'light' : readText(key) === 'true';
    checkbox.onchange = () => { writeText(key, key === 'hh-theme' ? checkbox.checked ? 'light' : 'dark' : checkbox.checked); if (key === 'hh-disguise') window.HHDisguise?.setEnabled(checkbox.checked); applySettings(); };
    label.append(text, checkbox); content.append(label);
  }
  const games = playable.filter(game => game.key || ['project-frontline','open-trails'].includes(game.id));
  const restartRow = element('div', 'setting-row restart-row');
  const restartText = element('span', '', 'Delete a game’s saved data');
  restartText.append(element('small', '', 'Deletes all saved progress, upgrades, unlocks and preferences for the selected game. High scores stay.'));
  const restartControls = element('div', 'restart-controls');
  const restartSelect = element('select');
  restartSelect.id = 'deleteGame';
  restartSelect.setAttribute('aria-label', 'Game data to delete');
  for (const game of games) {
    const option = element('option', '', game.title);
    option.value = game.key || game.id;
    restartSelect.append(option);
  }
  const selected = new URLSearchParams(location.search).get('settings');
  if (games.some(game => (game.key || game.id) === selected)) restartSelect.value = selected;
  const restart = element('button', 'text-btn danger-btn', 'Delete');
  restart.id = 'deleteGameBtn';
  restart.type = 'button';
  restart.onclick = async () => {
    const game = games.find(item => (item.key || item.id) === restartSelect.value);
    if (!game || !account || restart.disabled) return;
    const ownerId = account.id;
    restart.disabled = true;
    try {
      if (!await confirmGameDeletion(game)) return;
      if (account?.id !== ownerId) { notify('Your account changed. Select the game again.'); return; }
      await clearGameData(game, ownerId);
      notify(`${game.title} will start fresh. High scores stay. An open copy reloads onto the new run.`);
    } catch (error) { notify(error.message); }
    finally { restart.disabled = false; if (restart.isConnected) restart.focus(); }
  };
  restartControls.append(restartSelect, restart);
  restartRow.append(restartText, restartControls);
  const reset = element('button', 'text-btn danger-btn', 'Reset favorites and history');
  reset.onclick = () => {
    if (!confirm('Clear this account’s favorites and launch history on all computers? Saved games and server records will stay.')) return;
    favorites.clear();
    write('hh-favorites', []); write('hh-plays', {});
    render(); notify('Favorites and history reset. Server records are unchanged.');
  };
  content.append(element('p', 'muted', 'Favorites, history and saved game progress sync to this PC through your account. Each game shows when its save is waiting or complete. Keep the game open until saving finishes before switching computers.'), element('hr'), restartRow, reset);
  openPanel('Your settings', content);
}

query('#recordsBtn').onclick = async () => {
  const content = element('div');
  content.append(element('p', 'muted', 'Best result per game, shared by players on this server. Scarlet Rush ranks completed runs by clear time: faster is better. Other games rank higher scores first. Ties keep the current record holder.'));
  const list = element('div', '', 'Loading records…'); list.setAttribute('aria-live', 'polite');
  const refresh = element('button', 'secondary-btn', 'Refresh records');
  function createAward(spec) {
    const button = element('button', 'secondary-btn record-award', '???');
    button.type = 'button';
    button.disabled = true;
    button.dataset.award = spec.id;
    button.title = spec.hiddenTitle;
    button.setAttribute('aria-expanded', 'false');
    const listSection = element('section', 'record-award-list');
    listSection.hidden = true;
    listSection.dataset.award = spec.id;
    listSection.setAttribute('aria-label', 'Award winners, first to last');
    let next = 0, loading = false, loaded = false;
    const rows = element('ol');
    const status = element('p', 'muted');
    status.setAttribute('role', 'status');
    const more = element('button', 'secondary-btn', 'Load more winners');
    more.hidden = true;
    listSection.append(element('h3', '', spec.heading), element('p', 'muted', spec.description), rows, status, more);
    async function load() {
      if (loading) return;
      loading = true; more.disabled = true;
      status.textContent = 'Loading award winners…';
      try {
        const data = await request('awards/' + spec.id + '?after=' + next);
        if (!content.isConnected) return;
        for (const winner of data.winners) {
          const row = element('li', 'record-row');
          row.value = winner.position;
          const name = element('span', 'record-player', `${winner.position}. ${winner.isYou ? '★ You · ' : ''}${winner.nickname}`);
          name.append(element('small', '', new Date(winner.achievedAt).toLocaleString()));
          row.append(name); rows.append(row);
        }
        next = data.next;
        more.hidden = next === null;
        more.textContent = 'Load more winners';
        status.textContent = rows.children.length ? '' : 'No winners recorded yet.';
        loaded = true;
      } catch (error) {
        if (content.isConnected) { status.textContent = error.message; more.hidden = false; more.textContent = 'Retry loading winners'; }
      } finally { loading = false; more.disabled = false; }
    }
    button.onclick = () => {
      listSection.hidden = !listSection.hidden;
      button.setAttribute('aria-expanded', String(!listSection.hidden));
      if (!listSection.hidden && !loaded) load();
    };
    more.onclick = load;
    return { button, list: listSection, apply(data) {
      const earned = data.awards?.[spec.field] === true;
      button.textContent = earned ? spec.revealed : '???';
      button.disabled = !earned;
      button.title = earned ? spec.revealedTitle : spec.hiddenTitle;
    } };
  }
  const fireworks = createAward({
    id: 'russian-fireworks', field: 'russianFireworks',
    hiddenTitle: 'Earn this Flight Sortie award to reveal it.',
    revealedTitle: 'See everyone who earned Russian fireworks, first to last.',
    revealed: '★ Russian fireworks', heading: 'Russian fireworks',
    description: 'Awarded for completing Final Flight. Winners appear from first to last; each player appears once.',
  });
  const roadster = createAward({
    id: 'roadster', field: 'roadster',
    hiddenTitle: 'Find and collect the Roadster to reveal it.',
    revealedTitle: 'See everyone who found and collected the Roadster, first to last.',
    revealed: '★ Roadster', heading: 'Roadster',
    description: 'Awarded for finding and collecting the Roadster. Winners appear from first to last; each player appears once.',
  });
  content.append(fireworks.button, fireworks.list, roadster.button, roadster.list);
  content.append(list, element('p', 'muted', 'All 27 games have records. Native games report the score or milestone shown beside their title automatically.'), refresh);
  openPanel('Records', content);
  async function update() {
    if (refresh.disabled) return;
    refresh.disabled = true;
    try {
      const data = await request('records');
      if (!content.isConnected) return;
      fireworks.apply(data);
      roadster.apply(data);
      if (account) mergePersonalBests(data.personalBests);
      list.replaceChildren(...playable.filter(game => game.metric).map(game => {
        const winner = data.records.find(entry => entry.gameId === game.id);
        const row = element('div', 'record-row'); const name = element('span', 'record-player', game.title);
        name.append(element('small','record-metric',game.metric));
        name.append(element('small', '', winner ? `${winner.isYou ? '★ You · ' : ''}${winner.nickname}` : 'Unclaimed · set the first record'));
        if (account) name.append(element('small', '', game.id === 'open-trails'
          ? `Your lifetime: ${formatScore(game, data.personalBests[game.id] || 0)} miles`
          : `Your best: ${formatScore(game, data.personalBests[game.id] || 0)}`));
        row.append(name, element('strong', '', winner ? `${formatScore(game, winner.score)} ${game.metric.toLowerCase()}` : '—'));
        return row;
      }));
    } catch (error) { if (content.isConnected) list.textContent = error.message; }
    finally { refresh.disabled = false; }
  }
  refresh.onclick = update;
  const timer = setInterval(() => { if (!dialog.open || !content.isConnected) clearInterval(timer); else update(); }, 10000);
  await update();
};

query('#profileBtn').onclick = () => {
  location.href = accountLink('/');
};

function buildCategories() {
  const names = ['All', ...new Set(listed(library).map(game => game.genre))];
  if (!names.includes(category)) category = 'All';
  query('#categories').replaceChildren(...names.map(name => {
    const button = element('button', 'category-btn', name);
    button.onclick = () => { category = name; render(); };
    return button;
  }));
}

let removalBusy = false;

function renderRemovalBanner() {
  const needed = removalState.needed || 5;
  const open = (Array.isArray(removalState.games) ? removalState.games : []).filter(game => game.vote && game.vote.status === 'open');
  const existing = query('#removalBanner');
  if (!open.length) {
    existing?.remove();
    return;
  }
  const section = existing || element('section', 'removal-banner');
  section.id = 'removalBanner';
  section.setAttribute('aria-labelledby', 'removalBannerTitle');
  const rule = element('p', 'muted', 'Every player can answer. The vote closes when ' + needed + ' vote to remove it or ' + needed + ' vote to keep it. If remove reaches ' + needed + ' first, the game leaves and anyone who has not answered is done. If keep reaches ' + needed + ' first, the game stays.');
  const error = element('p', 'removal-error', '');
  error.id = 'removalError';
  error.setAttribute('role', 'alert');
  const rows = open.map(game => {
    const row = element('article', 'removal-vote');
    const details = element('div');
    const vote = game.vote;
    details.append(
      element('h3', '', game.title),
      element('p', '', 'Started by ' + vote.startedBy + '. Remove ' + vote.remove + ' · Keep ' + vote.keep + '.')
    );
    const actions = element('div', 'removal-vote-actions');
    if (vote.mine === 'remove') details.append(element('p', '', 'You voted to remove it.'));
    else if (vote.mine === 'keep') details.append(element('p', '', 'You voted to keep it.'));
    else if (!account) {
      const link = element('a', 'secondary-btn', 'Sign in to vote');
      link.href = accountLink('/');
      actions.append(link);
    } else {
      for (const [label, choice] of [['Vote to remove', 'remove'], ['Vote to keep', 'keep']]) {
        const button = element('button', 'secondary-btn', label);
        button.type = 'button';
        button.setAttribute('aria-label', label + ' ' + game.title);
        button.onclick = () => castLibraryVote(vote.id, choice);
        actions.append(button);
      }
    }
    row.append(details, actions);
    return row;
  });
  section.replaceChildren(element('h2', '', 'Vote to remove a user submission'), rule, error, ...rows);
  section.querySelector('h2').id = 'removalBannerTitle';
  if (!existing) query('#gamesSection').before(section);
}

async function castLibraryVote(voteId, choice) {
  if (removalBusy) return;
  removalBusy = true;
  const errorNode = query('#removalError');
  if (errorNode) errorNode.textContent = '';
  try {
    removalState = await request('removal-votes/ballot', { voteId, choice });
    const game = (Array.isArray(removalState.games) ? removalState.games : []).find(item => item.vote && item.vote.id === voteId);
    if (game?.vote?.status === 'passed') {
      removedGameIds.add(game.id);
      gameCards.get(game.id)?.remove();
      gameCards.delete(game.id);
      buildCategories();
      render();
      notify(game.title + ' was removed from the library. The vote is closed.');
    } else if (game?.vote?.status === 'kept') {
      notify(game.title + ' stays in the library. The vote is closed.');
    }
    renderRemovalBanner();
  } catch (error) {
    const current = query('#removalError');
    if (current) current.textContent = error.message;
  } finally {
    removalBusy = false;
  }
}

buildCategories();
query('#searchInput').oninput = render; query('#sortSelect').onchange = render;
query('#clearBtn').onclick = () => { category = 'All'; query('#searchInput').value = ''; query('#sortSelect').value = 'featured'; render(); };
query('#homeBtn').onclick = () => { query('#clearBtn').click(); query('#gamesSection').scrollIntoView(); };
query('#randomBtn').onclick = () => {
  const game = matchingGames[Math.floor(Math.random() * matchingGames.length)];
  if (!game) return;
  window.open(game.url, '_blank', 'noopener,noreferrer'); trackLaunch(game.id); render();
};
query('#retryConnection').onclick = () => location.reload();
query('#settingsBtn').onclick = settings;
query('#musicBtn').onclick = soundtrack.open;
query('#soundtrackBtn').onclick = soundtrack.open;
query('#closePanelBtn').onclick = () => dialog.close();
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
function recordLaunch(event) {
  const link = event.target.closest('[data-launch]');
  if (link) { trackLaunch(link.dataset.launch); setTimeout(render, 0); }
}
document.addEventListener('click', recordLaunch);
document.addEventListener('auxclick', event => { if (event.button === 1) recordLaunch(event); });
window.addEventListener('pageshow', () => { applySettings(); render(); });
const storagePrefix = account ? `hh-user-${account.id}-` : '';
const libraryStorageKeys = new Set(['hh-favorites', 'hh-records', 'hh-plays'].map(key => storagePrefix + key));
const preferenceStorageKeys = new Set(['hh-compact', 'hh-reduce-motion', 'hh-theme', 'hh-disguise']);
window.addEventListener('storage', event => {
  if (event.key !== null && !libraryStorageKeys.has(event.key) && !preferenceStorageKeys.has(event.key)) return;
  if (event.key === null || event.key === storagePrefix + 'hh-favorites') {
    const saved = read('hh-favorites', []);
    favorites.clear();
    if (Array.isArray(saved)) saved.filter(id => validIds.has(id)).forEach(id => favorites.add(id));
  }
  if (event.key === null || preferenceStorageKeys.has(event.key)) applySettings();
  if (event.key === null || libraryStorageKeys.has(event.key)) render();
});
window.addEventListener('hh-account-save-changed', event => {
  if (event.detail.keys.includes('hh-favorites')) {
    const saved = read('hh-favorites', []); favorites.clear();
    if (Array.isArray(saved)) saved.filter(id => validIds.has(id)).forEach(id => favorites.add(id));
  }
  render();
});
window.addEventListener('hh-storage-unavailable', () => notify(account ? 'Browser backup is unavailable. Progress still saves to your account.' : 'Browser storage is unavailable. Changes last for this visit only.'));
window.addEventListener('hh-save-sync', () => { if (accountSaveStatus().includes('retrying')) notify('Progress waiting to sync. Keep this page open; it will retry automatically.'); });
applySettings();
renderRemovalBanner();
render();
if (new URLSearchParams(location.search).get('view') === 'records') query('#recordsBtn').click();

if (new URLSearchParams(location.search).has('settings')) settings();
