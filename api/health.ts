import { app } from '../server/app';

export default function handler(req: any, res: any) {
  if (!req.url || req.url === '/' || req.url.startsWith('/?')) {
    req.url = '/api/health' + (req.url.startsWith('/?') ? req.url.slice(1) : '');
  }
  return app(req, res);
}
