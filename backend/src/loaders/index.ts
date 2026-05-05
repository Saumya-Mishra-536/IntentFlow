import { Application } from 'express';

import { createApp } from '../app';
import { initDatabase } from './database';

const loaders = async (): Promise<Application> => {
  await initDatabase();
  const app = await createApp();
  return app;
};

export default loaders;


