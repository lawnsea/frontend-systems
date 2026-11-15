import { fetchAndInstall } from './install.js';
import { ExportedWorker } from './exported-worker.js';
import { InboundWorkerDOMConfiguration } from './configuration.js';

export type UpgradeConfiguration = Omit<InboundWorkerDOMConfiguration, 'authorURL' | 'domURL'>;

export function upgradeElement(baseElement: Element, domURL: string, config: UpgradeConfiguration = {}): Promise<ExportedWorker | null> {
  const authorURL = baseElement.getAttribute('src');
  if (authorURL) {
    return fetchAndInstall(baseElement as HTMLElement, {
      ...config,
      authorURL,
      domURL,
    });
  }
  return Promise.resolve(null);
}
