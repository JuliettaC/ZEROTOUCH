// Passwords too common to accept with an 8-character minimum. Local and reduced on purpose: no
// external service is queried. It is not an exhaustive breached-password list (see auditoría).
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'contraseña', 'contrasena', 'contraseña1', 'contrasena1', 'contraseña123', 'contrasena123', 'micontraseña', 'micontrasena',
  '11111111', '00000000', '12341234', '12121212', '11223344', '123123123', '12344321', '11112222',
  '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', '1qaz2wsx', 'zaq12wsx', 'qazwsxedc', '123qweasd', 'qweasdzxc',
  'qwerty12', 'qwerty123', 'qwerty1234', 'zxcvbnm1', 'abc12345', 'abcd1234', 'a1b2c3d4', 'aa123456', 'abc123456', 'asd12345',
  'iloveyou', 'iloveyou1', 'teamo123', 'teamomucho', 'tequiero', 'tequiero1', 'princesa', 'princesa1', 'superman', 'batman123',
  'football', 'baseball', 'sunshine', 'starwars', 'whatever', 'trustno1', 'letmein1', 'welcome1', 'welcome123',
  'bienvenido', 'bienvenida', 'administrador', 'admin123', 'admin1234', 'administrator', 'changeme', 'cambiame',
  'master123', 'dragon123', 'monkey123', 'passwort', 'motdepasse', 'chocolate', 'mariposa', 'estrella', 'corazon1',
  'pokemon1', 'minecraft', 'fortnite', 'google123', 'facebook', 'internet', 'computer', 'computadora', 'universidad',
  'chile123', 'mexico123', 'argentina', 'colombia', 'peru1234', 'españa1', 'espana12', 'futbol123', 'barcelona', 'realmadrid',
  'zerotouch', 'zerotouch1', 'zerotouch123',
]);
// Straight runs such as 12345678, 87654321, abcdefgh or keyboard rows.
const RUNS = ['01234567890', '09876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm'];

export function isCommonPassword(value) {
  const lowered = value.trim().toLowerCase();
  return COMMON.has(lowered) || /^(.)\1+$/u.test(lowered) || RUNS.some(run => run.includes(lowered));
}
