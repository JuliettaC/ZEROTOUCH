import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const port = Number(process.env.PORT || 3000);
