// Test-only WebView exercise against the real native bridge and Hito 2 backend, never a mocked API.
(async () => {
  if (window.__zerotouchSmokeStarted) return;
  window.__zerotouchSmokeStarted = true;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const wait = async test => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const result = test();
      if (result) return result;
      await delay(50);
    }
    throw new Error('Tiempo agotado: ' + test.toString());
  };
  const button = (text, root = document) =>
    [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text && !b.disabled);
  const click = async (text, root = document) => {
    (await wait(() => button(text, root))).click();
    await delay(50);
  };
  const fill = async (name, value, root = document) => {
    const input = await wait(() => root.querySelector(`[name="${name}"]`));
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(50);
  };
  const marker = document.createElement('p');
  marker.id = 'smoke-result';
  marker.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;background:white;padding:14px;border:2px solid #5F4D47;z-index:9999';
  const invoke = window.__TAURI__.core.invoke;
  const secretPattern = /csrf_token|csrfToken|zt_session|contrasena_hash|password_hash/;
  window.__TAURI__.core.invoke = async (...args) => {
    const value = await invoke(...args);
    if (secretPattern.test(JSON.stringify(value))) throw new Error('Secreto expuesto');
    return value;
  };
  try {
    // 1. Verify Control Center opens directly without login (offline-first)
    await wait(() => document.querySelector('.dashboard-page'));
    await wait(() => button('Registrarse'));

    // 2. Register a new account via UI
    await click('Registrarse');
    let dialog = await wait(() => document.querySelector('dialog[open]'));
    await fill('username', 'ui_vertical_test', dialog);
    await fill('password', 'Credencial sintética de prueba 2026!', dialog);
    await click('Registrarse', dialog);

    // 3. Log in via UI
    await wait(() => button('Iniciar sesión', dialog));
    await fill('password', 'Credencial sintética de prueba 2026!', dialog);
    await click('Iniciar sesión', dialog);
    await wait(() => !document.querySelector('dialog[open]'));

    // 4. Verify authenticated username in header and /auth/me restoration
    await wait(() => button('Cuenta (ui_vertical_test)'));
    const me = await invoke('account');
    if (me.nombre_usuario !== 'ui_vertical_test') throw new Error('Cuenta incorrecta');

    // 5. Open Account dialog and synchronize with SQLite
    await click('Cuenta (ui_vertical_test)');
    dialog = await wait(() => document.querySelector('dialog[open]'));
    await click('Sincronizar ahora', dialog);
    await wait(() => dialog.textContent.includes('Preferencias sincronizadas con el servicio.'));

    // 6. Log out and verify session is revoked
    await click('Cerrar sesión', dialog);
    await wait(() => button('Iniciar sesión'));
    let rejected = false;
    try {
      await invoke('account');
    } catch (e) {
      rejected = e.code === 'SESION_INVALIDA' || e.code === 'UNAUTHENTICATED';
    }
    if (!rejected) throw new Error('Sesión no cerrada');

    marker.textContent =
      'PRUEBA UI CORRECTA: Control Center sin bloqueo, registro, login, /auth/me, sincronización Hito 2 y logout sin exponer secretos.';
  } catch (e) {
    marker.textContent = 'PRUEBA UI FALLIDA: ' + (e.code || 'ERROR') + ' — ' + (e.message || String(e));
  }
  document.body.append(marker);
})();
