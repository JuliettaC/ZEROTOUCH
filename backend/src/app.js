import express from 'express';
import healthRoutes from './routes/healthRoutes.js';

const app = express();
app.use('/api', healthRoutes);

export default app;
