import { postgresDatabase } from "./postgres-d1";
export const env = { ...process.env, DB: postgresDatabase };
