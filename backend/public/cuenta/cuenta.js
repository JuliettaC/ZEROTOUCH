/* global document, history, location */
// Account pages opened from ZeroTouch emails. No third-party code, no storage.
// The token comes from the URL fragment (#token=...), which is never sent to the server in the
// page request; it is removed from the address bar and history right away.
(() => {
  'use strict';
  const page = document.body.dataset.pagina;
  const params = new URLSearchParams(location.hash.slice(1));
  const raw = params.get('token') ?? '';
  const token = /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
  if (location.hash) history.replaceState(null, '', location.pathname);

  const views = [...document.querySelectorAll('[data-vista]')];
  const message = document.getElementById('mensaje');
  const title = document.getElementById('titulo');
  function show(...names) {
    for (const view of views) view.hidden = !names.includes(view.dataset.vista);
    message.hidden = true;
    title.focus();
  }
  function notify(text, kind = '') {
    message.textContent = text;
    message.className = `estado ${kind}`.trim();
    message.hidden = false;
  }
  async function post(route, body) {
    try {
      const response = await fetch(`/api/v1/auth/${route}`, {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }
  const failure = result => result.status === 429 ? 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.'
    : result.status === 0 ? 'No se pudo contactar al servidor de ZeroTouch. Comprueba que esté en ejecución.'
      : result.data?.mensaje ?? 'No se pudo completar la operación.';
  const validEmail = value => value.length >= 6 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  function bindEmailForm(id, route, done) {
    const form = document.getElementById(id);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const input = form.querySelector('input[type=email]');
      const correo = input.value.trim();
      if (!validEmail(correo)) { input.setAttribute('aria-invalid', 'true'); notify('Escribe un correo válido.', 'error'); input.focus(); return; }
      input.removeAttribute('aria-invalid');
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      const result = await post(route, { correo });
      button.disabled = false;
      notify(result.status === 202 ? done : failure(result), result.status === 202 ? 'ok' : 'error');
    });
  }

  if (page === 'verificar') {
    bindEmailForm('reenviar', 'verificacion/reenviar', 'Si la cuenta sigue pendiente, enviamos un enlace nuevo. Revisa tu correo y la carpeta de spam.');
    if (!token) { show('invalido', 'reenviar'); return; }
    show('confirmar');
    const button = document.getElementById('confirmar');
    button.addEventListener('click', async () => {
      button.disabled = true;
      const result = await post('verificacion', { token });
      button.disabled = false;
      if (result.status === 200) show('exito');
      else if (result.data?.error === 'TOKEN_EXPIRADO') show('expirado', 'reenviar');
      else if (result.data?.error === 'TOKEN_INVALIDO') show('invalido', 'reenviar');
      else notify(failure(result), 'error');
    });
  }

  if (page === 'restablecer') {
    bindEmailForm('solicitar', 'contrasena/olvido', 'Si existe una cuenta con ese correo, enviamos un enlace. Revisa tu bandeja de entrada y la carpeta de spam.');
    for (const toggle of document.querySelectorAll('[data-mostrar]')) {
      toggle.addEventListener('click', () => {
        const input = document.getElementById(toggle.dataset.mostrar);
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        toggle.textContent = visible ? 'Ocultar' : 'Mostrar';
        toggle.setAttribute('aria-pressed', String(visible));
      });
    }
    if (!token) { show('solicitar'); return; }
    show('nueva');
    const form = document.getElementById('nueva');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const first = document.getElementById('contrasena'), second = document.getElementById('confirmacion');
      const length = [...first.value].length;
      if (length < 8 || length > 128) { notify('La contraseña debe tener entre 8 y 128 caracteres.', 'error'); first.focus(); return; }
      if (first.value !== second.value) { notify('Las contraseñas no coinciden.', 'error'); second.focus(); return; }
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      const result = await post('contrasena/restablecer', { token, contrasena: first.value });
      button.disabled = false;
      if (result.status === 200) { first.value = ''; second.value = ''; show('exito'); }
      else if (result.data?.error === 'TOKEN_EXPIRADO') show('expirado', 'solicitar');
      else if (result.data?.error === 'TOKEN_INVALIDO') show('invalido', 'solicitar');
      else notify(failure(result), 'error');
    });
  }
})();
