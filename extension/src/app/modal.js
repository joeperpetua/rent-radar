import { $, reduceMotion } from './dom.js';

function closeModal(dialog, value) {
  if (dialog.classList.contains('closing') || !dialog.open) return;
  if (reduceMotion()) {
    dialog.close(value);
    return;
  }
  dialog.classList.add('closing');
  const done = (e) => {
    if (e.target !== dialog) return;
    dialog.removeEventListener('animationend', done);
    dialog.classList.remove('closing');
    dialog.close(value);
  };
  dialog.addEventListener('animationend', done);
}

export function bindModal(dialog) {
  dialog.addEventListener('click', (e) => {
    const value = e.target.closest('[data-modal]')?.dataset.modal;
    if (value) closeModal(dialog, value);
    else if (e.target === dialog) closeModal(dialog, 'cancel');
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeModal(dialog, 'cancel');
  });
}

export function askConfirm(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    $('[data-modal="cancel"]', dialog).focus();
  });
}
