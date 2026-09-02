// Loaded first (before any module that reads process.env). In local dev this
// pulls .env from the api dir and the repo root; in containers env is injected
// directly and these files simply don't exist (dotenv is a no-op then).
import { config as loadDotenv } from 'dotenv';

loadDotenv();
loadDotenv({ path: '../../.env' });
