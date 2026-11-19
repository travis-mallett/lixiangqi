import { memoize } from './common';

export const baseUrl: () => string = memoize(() => document.body.getAttribute('data-asset-url') || '');

const assetVersion = memoize(() => document.body.getAttribute('data-asset-version'));

export const url = (path: string, opts: AssetUrlOpts = {}): string => {
  const base = opts.documentOrigin ? window.location.origin : opts.pathOnly ? '' : baseUrl();
  const pathVersion = !opts.pathVersion
    ? ''
    : opts.pathVersion === true
      ? `_${assetVersion()}/`
      : `_${opts.pathVersion}/`;
  const hash = !pathVersion && site.manifest.hashed[path];
  return `${base}/assets/${hash ? asHashed(path, hash) : `${pathVersion}${path}`}`;
};

function asHashed(path: string, hash: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const extPos = name.lastIndexOf('.');
  return `hashed/${extPos < 0 ? `${name}.${hash}` : `${name.slice(0, extPos)}.${hash}${name.slice(extPos)}`}`;
}
