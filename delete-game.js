import { remove, writeText, deleteAccountSaves } from './storage.js?v=20261013-account-saves-1';
import { gameSaveKey } from './game-progress.js?v=20261012-reset-1';

// This allowlist never includes personal bests or server record data.
export async function clearGameData(game, accountId) {
  const keys = game.id === 'project-frontline' ? ['hh-save-frontline-web-v1']
    : game.id === 'open-trails' ? [gameSaveKey(game.id)]
    : [...(game.key === 'miner' ? ['hh-quarry'] : []), ...new Set([`hh-save-${game.key}-v2`, gameSaveKey(game.key)])];
  await deleteAccountSaves(keys, accountId);
  for (const key of keys) remove(key, { legacy: true });
  writeText(`hh-user-${accountId}-game-data-deleted`, JSON.stringify({
    game: game.key || game.id, nonce: crypto.randomUUID()
  }));
  return true;
}

export function confirmGameDeletion(game) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.id = 'deleteGameDialog';
    dialog.setAttribute('aria-labelledby', 'deleteGameTitle');
    dialog.setAttribute('aria-describedby', 'deleteGameWarning');
    const title = document.createElement('h2'); title.id = 'deleteGameTitle'; title.textContent = 'Are you sure?';
    const warning = document.createElement('p'); warning.id = 'deleteGameWarning';
    warning.textContent = `This deletes all saved data for ${game.title} from your account on every computer, including progress, upgrades, unlocks and game preferences. High scores and Records page scores stay. This cannot be undone.`;
    const countdown = document.createElement('p'); countdown.id = 'deleteGameCountdown'; countdown.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'cancelDeleteGame'; cancel.className = 'secondary-btn'; cancel.textContent = 'Cancel';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.id = 'confirmDeleteGame'; confirm.className = 'primary-btn danger-btn'; confirm.textContent = 'Delete game data';
    cancel.disabled = confirm.disabled = true;
    actions.append(cancel, confirm); dialog.append(title, warning, countdown, actions); document.body.append(dialog);
    const unlockAt = performance.now() + 5000;
    let answer = false;
    const ready = () => performance.now() >= unlockAt;
    function update() {
      const seconds = Math.max(0, Math.ceil((unlockAt - performance.now()) / 1000));
      countdown.textContent = seconds ? `Read the warning. You can answer in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.` : 'You can now cancel or delete the selected game’s data.';
      if (ready()) { cancel.disabled = confirm.disabled = false; clearInterval(timer); cancel.focus(); }
    }
    const timer = setInterval(update, 100);
    cancel.onclick = () => { if (ready()) dialog.close(); };
    confirm.onclick = () => { if (ready()) { answer = true; dialog.close(); } };
    dialog.addEventListener('cancel', event => { if (!ready()) event.preventDefault(); });
    dialog.addEventListener('close', () => { clearInterval(timer); dialog.remove(); resolve(answer); }, { once: true });
    dialog.showModal(); update();
  });
}
