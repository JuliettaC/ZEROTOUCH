import app from './app.js';
import { port } from './config/env.js';

app.listen(port, () => {
  console.log(`ZeroTouch API disponible en http://localhost:${port}`);
});
