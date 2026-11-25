import { randomBytes } from 'node:crypto';

// Genera una clave de cifrado de 256 bits para DATABASE_KEY. Se imprime solo en esta terminal; cópiala al .env de la
// raíz (nunca a Git, al .env.example ni a un documento). Si se pierde, la base cifrada no se puede recuperar.
console.log(`DATABASE_KEY=${randomBytes(32).toString('hex')}`);
