import { defined, prop } from 'lib';
import { throttle } from 'lib/async';
import { rulesPositionKey, type RulesPosition } from 'lib/game/xiangqiNotation';
import { pubsub, type PubsubEvents } from 'lib/pubsub';
import type { ClientEval, PvData, ServerEval, TreeNode, TreePath } from 'lib/tree/types';

import type { EvalHit, EvalGetData, EvalPutData } from './interfaces';
import type { AnalyseSocketSend } from './socket';

export interface EvalCacheOpts {
  getPosition(path?: TreePath): RulesPosition | undefined;
  receive(ev: ClientEval, path: TreePath): void;
  send: AnalyseSocketSend;
  getNode(): TreeNode;
  canPut(): boolean;
  canGet(): boolean;
  upgradable: boolean;
}

const evalPutMinDepth = 20;
const evalPutMinNodes = 3e6;
const evalPutMaxMoves = 10;

function qualityCheck(ev: ClientEval): boolean {
  // quick mates may never reach the minimum nodes or depth
  if (Math.abs(ev.mate ?? 99) < 15) return true;
  // below 500k nodes, the eval might come from an imminent threefold repetition
  // and should therefore be ignored
  return ev.nodes > 500000 && (ev.depth >= evalPutMinDepth || ev.nodes > evalPutMinNodes);
}

// from client eval to server eval
function toPutData(position: RulesPosition, ev: ClientEval): EvalPutData {
  const data: EvalPutData = {
    position,
    knodes: Math.round(ev.nodes / 1000),
    depth: ev.depth,
    pvs: ev.pvs.map(pv => {
      return {
        cp: pv.cp,
        mate: pv.mate,
        moves: pv.moves.slice(0, evalPutMaxMoves).join(' '),
      };
    }),
  };
  return data;
}

// from server eval to client eval
function toCeval(e: ServerEval): ClientEval {
  const res: ClientEval = {
    fen: e.fen,
    nodes: e.knodes * 1000,
    depth: e.depth,
    pvs: e.pvs.map(from => {
      const to: PvData = {
        moves: from.moves.split(' '), // moves come from the server as a single string
      };
      if (defined(from.cp)) to.cp = from.cp;
      else to.mate = from.mate;
      return to;
    }),
    cloud: true,
  };
  if (defined(res.pvs[0].cp)) res.cp = res.pvs[0].cp;
  else res.mate = res.pvs[0].mate;
  res.cloud = true;
  return res;
}

type AwaitingEval = null;
const awaitingEval: AwaitingEval = null;

export default class EvalCache {
  private readonly fetchedByPosition: Map<FEN, EvalHit | AwaitingEval> = new Map();
  upgradable = prop(false);

  constructor(readonly opts: EvalCacheOpts) {
    this.upgradable(opts.upgradable);
    pubsub.on('socket.in.crowd', this.onCrowd);
  }

  destroy = () => pubsub.off('socket.in.crowd', this.onCrowd);

  private readonly onCrowd: PubsubEvents['socket.in.crowd'] = d => this.upgradable(d.nb > 2 && d.nb < 99999);

  onLocalCeval = throttle(500, () => {
    const node = this.opts.getNode(),
      ev = node.ceval;
    const position = this.opts.getPosition();
    if (!position) return;
    const key = rulesPositionKey(position);
    const fetched = this.fetchedByPosition.get(key);
    if (
      ev &&
      !ev.cloud &&
      this.fetchedByPosition.has(key) &&
      fetched !== undefined &&
      (fetched === awaitingEval || fetched.depth < ev.depth) &&
      ev.fen === node.fen &&
      qualityCheck(ev) &&
      this.opts.canPut()
    ) {
      this.opts.send('evalPut', toPutData(position, ev));
    }
  });

  fetch = (path: TreePath, multiPv: number): void => {
    if (document.hidden) return;
    const node = this.opts.getNode();
    if (node.ceval?.cloud || !this.opts.canGet()) return;
    const position = this.opts.getPosition();
    if (!position) return;
    const key = rulesPositionKey(position);
    const fetched = this.fetchedByPosition.get(key);
    if (fetched) return this.opts.receive(toCeval(fetched), path);
    else if (fetched === awaitingEval) return;
    const obj: EvalGetData = {
      position,
      path,
    };
    if (multiPv > 1) obj.mpv = multiPv;
    if (this.upgradable()) obj.up = true;
    this.fetchThrottled(obj);
  };

  onCloudEval = (ev: EvalHit) => {
    const key = rulesPositionKey(ev.position);
    this.fetchedByPosition.set(key, ev);
    const current = this.opts.getPosition(ev.path);
    if (current && rulesPositionKey(current) === key) this.opts.receive(toCeval(ev), ev.path);
  };

  clear = () => this.fetchedByPosition.clear();

  private readonly fetchThrottled = throttle(700, (obj: EvalGetData) => {
    this.fetchedByPosition.set(rulesPositionKey(obj.position), awaitingEval); // waiting for response
    this.opts.send('evalGet', obj);
  });
}
