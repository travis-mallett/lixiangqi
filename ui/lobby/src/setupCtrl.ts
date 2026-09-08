import { type Prop, propWithEffect, toggle } from 'lib';
import { debounce } from 'lib/async';
import type { ColorChoice, ColorProp } from 'lib/setup/color';
import {
  allTimeModeKeys,
  timeControlFromStoredValues,
  timeModes,
  type TimeControl,
} from 'lib/setup/timeControl';
import { storedJsonProp } from 'lib/storage';
import { alert } from 'lib/view';
import * as xhr from 'lib/xhr';

import type LobbyController from './ctrl';
import type { AiStatsResponse, ForceSetupOptions, GameType, SetupStore } from './interfaces';
import { keyToId, variants } from './options';

export default class SetupController {
  root: LobbyController;
  store: Record<GameType, Prop<SetupStore>>;
  gameType: GameType | null = null;
  lastValidFen = '';
  fenError = false;
  friendUser = '';
  loading = false;
  aiStats?: AiStatsResponse;
  aiStatsLoading = false;
  aiStatsFailed = false;
  aiTimeControls = false;
  ruleset = 'tiantian-v1';
  private aiTimedMode: 'realTime' | 'correspondence' = 'realTime';
  private aiStatsRequest = 0;
  color: ColorProp;
  forced?: ForceSetupOptions;

  // Store props
  variant: Prop<VariantKey>;
  fen: Prop<string>;
  aiLevel: Prop<number>;

  variantMenuOpen = toggle(false);

  timeControl: TimeControl;

  constructor(ctrl: LobbyController) {
    this.root = ctrl;
    this.color = propWithEffect('random', this.onPropChange);
    // Initialize stores with default props as necessary
    this.store = {
      hook: this.makeSetupStore('hook'),
      friend: this.makeSetupStore('friend'),
      ai: this.makeSetupStore('ai'),
    };
  }

  // Namespace the store by username for user specific modal settings
  private readonly storeKey = (gameType: GameType) =>
    `lobby.setup.${this.root.me?.username || 'anon'}.${gameType}`;

  makeSetupStore = (gameType: GameType) =>
    storedJsonProp<SetupStore>(this.storeKey(gameType), () => ({
      variant: 'standard',
      fen: '',
      timeMode: gameType === 'hook' ? 'realTime' : 'unlimited',
      time: 5,
      increment: 3,
      moveTime: undefined,
      days: 2,
      color: 'random',
      aiLevel: 1,
      aiTimeControls: false,
    }));

  private readonly loadPropsFromStore = (forceOptions?: ForceSetupOptions) => {
    const storeProps = this.store[this.gameType!]();
    // Load props from the store, but override any store values with values found in forceOptions
    this.variant = propWithEffect(forceOptions?.variant || storeProps.variant, this.onDropdownChange);
    this.fen = this.propWithApply(forceOptions?.fen || storeProps.fen);
    const canChangeTimeMode = !!this.root.me || this.gameType !== 'hook';
    const requestedTimeMode =
      forceOptions?.timeMode ||
      (this.gameType === 'ai' && storeProps.aiTimeControls !== true ? 'unlimited' : storeProps.timeMode);
    this.aiTimeControls = this.gameType === 'ai' && requestedTimeMode !== 'unlimited';
    this.aiTimedMode = requestedTimeMode === 'correspondence' ? 'correspondence' : 'realTime';
    this.timeControl = timeControlFromStoredValues(
      propWithEffect(requestedTimeMode, this.onDropdownChange),
      canChangeTimeMode ? allTimeModeKeys : ['realTime'],
      forceOptions?.time ?? storeProps.time,
      forceOptions?.increment ?? storeProps.increment,
      forceOptions?.days ?? storeProps.days,
      forceOptions && Object.prototype.hasOwnProperty.call(forceOptions, 'moveTime')
        ? forceOptions.moveTime
        : storeProps.moveTime,
      this.onPropChange,
      this.root.pools,
    );
    this.aiLevel = this.propWithApply(storeProps.aiLevel);
    this.color(forceOptions?.color || storeProps.color || 'random');

    this.enforcePropRules();
    // Upon loading the props from the store, overriding with forced options, and enforcing rules,
    // immediately save them to the store. This way, the user can know that whatever they saw last
    // in the modal will be there when they open it at a later time.
    this.savePropsToStore();
  };

  private readonly enforcePropRules = () => {
    // reassign with this.propWithApply in this function to avoid calling this.onPropChange

    // replace underscores with spaces in FEN
    if (this.variant() === 'fromPosition') this.fen = this.propWithApply(this.fen().replace(/_/g, ' '));
  };

  private readonly savePropsToStore = (override: Partial<SetupStore> = {}) =>
    this.gameType &&
    this.store[this.gameType]({
      variant: this.variant(),
      fen: this.fen(),
      timeMode: this.timeControl.mode(),
      time: this.timeControl.time(),
      increment: this.timeControl.increment(),
      moveTime: this.timeControl.moveTime(),
      days: this.timeControl.days(),
      color: this.color(),
      aiLevel: this.aiLevel(),
      aiTimeControls: this.gameType === 'ai' ? this.aiTimeControls : undefined,
      ...override,
    });

  private readonly onPropChange = () => {
    this.savePropsToStore();
    this.root.redraw();
  };

  private readonly onDropdownChange = () => {
    this.enforcePropRules();
    this.savePropsToStore();
    this.root.redraw();
  };

  private readonly propWithApply = <A>(value: A) => propWithEffect(value, this.onPropChange);

  openModal = (
    gameType: Exclude<GameType, 'local'>,
    forceOptions?: ForceSetupOptions,
    friendUser?: string,
  ) => {
    this.root.leavePool();
    this.gameType = gameType;
    this.loading = false;
    this.fenError = false;
    this.lastValidFen = '';
    this.friendUser = friendUser || '';
    this.variantMenuOpen(false);
    this.forced = forceOptions;
    this.loadPropsFromStore(forceOptions);
    if (gameType === 'ai') void this.loadAiStats();
  };

  setAiTimeControls = (enabled: boolean) => {
    if (enabled === this.aiTimeControls) return;
    if (!enabled && this.timeControl.mode() !== 'unlimited') {
      this.aiTimedMode = this.timeControl.mode() as 'realTime' | 'correspondence';
    }
    this.aiTimeControls = enabled;
    this.timeControl.mode(enabled ? this.aiTimedMode : 'unlimited');
  };

  private readonly loadAiStats = async () => {
    const request = ++this.aiStatsRequest;
    this.aiStats = undefined;
    this.aiStatsLoading = true;
    this.aiStatsFailed = false;
    this.root.redraw();
    try {
      const response = await xhr.json<AiStatsResponse>('/setup/ai/stats');
      if (request === this.aiStatsRequest) this.aiStats = response;
    } catch (_) {
      if (request === this.aiStatsRequest) this.aiStatsFailed = true;
    } finally {
      if (request === this.aiStatsRequest) {
        this.aiStatsLoading = false;
        this.root.redraw();
      }
    }
  };

  closeModal?: () => void; // managed by view/setup/modal.ts

  toggleVariantMenu = () => {
    this.variantMenuOpen.toggle();
    this.root.redraw();
  };

  validateFen = debounce(() => {
    const fen = this.fen();
    if (!fen) return;
    xhr
      .text(
        xhr.url('/setup/validate-fen', {
          fen,
          strict: this.gameType === 'ai' ? 1 : undefined,
        }),
      )
      .then(
        () => {
          this.fenError = false;
          this.lastValidFen = fen;
          this.root.redraw();
        },
        () => {
          this.fenError = true;
          this.root.redraw();
        },
      );
  }, 300);

  propsToFormData = (color: ColorChoice) =>
    xhr.form({
      variant: keyToId(this.variant(), variants).toString(),
      fen: this.variant() === 'fromPosition' ? this.fen() : undefined,
      timeMode: keyToId(this.timeControl.mode(), timeModes).toString(),
      time: this.timeControl.time().toString(),
      time_range: this.timeControl.timeV().toString(),
      increment: this.timeControl.increment().toString(),
      increment_range: this.timeControl.incrementV().toString(),
      'moveTime.seconds': this.timeControl.isRealTime()
        ? this.timeControl.moveTime()?.seconds.toString()
        : undefined,
      'moveTime.firstMoves': this.timeControl.isRealTime()
        ? this.timeControl.moveTime()?.first?.moves.toString()
        : undefined,
      'moveTime.firstSeconds': this.timeControl.isRealTime()
        ? this.timeControl.moveTime()?.first?.seconds.toString()
        : undefined,
      days: this.timeControl.days().toString(),
      days_range: this.timeControl.daysV().toString(),
      level: this.aiLevel().toString(),
      ruleset: this.gameType === 'hook' ? undefined : this.ruleset,
      color,
    });

  validFen = () => this.variant() !== 'fromPosition' || (!this.fenError && !!this.fen());

  valid = () =>
    this.validFen() && this.timeControl.valid(this.minimumTimeIfReal()) && this.validConstraints();

  private readonly invalid = <A>(forced: A | undefined, current: A) =>
    forced !== undefined && forced !== current;

  private readonly validConstraints = () => {
    if (this.forced) {
      if (this.invalid(this.forced.variant, this.variant())) return false;
      if (this.invalid(this.forced.timeMode, this.timeControl.mode())) return false;
      if (this.invalid(this.forced.color, this.color())) return false;
      if (
        this.timeControl.mode() === 'correspondence' &&
        this.invalid(this.forced.days, this.timeControl.days())
      )
        return false;
      if (this.timeControl.mode() === 'realTime') {
        if (this.invalid(this.forced.time, this.timeControl.time())) return false;
        if (this.invalid(this.forced.increment, this.timeControl.increment())) return false;
        if (
          Object.prototype.hasOwnProperty.call(this.forced, 'moveTime') &&
          JSON.stringify(this.forced.moveTime) !== JSON.stringify(this.timeControl.moveTime())
        )
          return false;
      }
      if (this.invalid(this.forced.fen?.replace(/_/g, ' '), this.fen())) return false;
    }
    return true;
  };

  minimumTimeIfReal = () => (this.gameType === 'ai' && this.variant() === 'fromPosition' ? 1 : 0);

  submit = async () => {
    const color = this.color();
    if (this.gameType === 'hook') this.root.setTab(this.timeControl.isRealTime() ? 'real_time' : 'seeks');
    this.loading = true;
    this.root.redraw();

    let urlPath = `/setup/${this.gameType}`;
    if (this.gameType === 'hook') urlPath += `/${site.sri}`;
    const urlParams = { user: this.friendUser || undefined };
    let response;
    try {
      response = await xhr.textRaw(xhr.url(urlPath, urlParams), {
        method: 'post',
        body: this.propsToFormData(color),
      });
    } catch (_) {
      this.loading = false;
      this.root.redraw();
      await alert('Sorry, we encountered an error while creating your game. Please try again.');
      return;
    }

    const { ok, redirected, url } = response;

    if (!ok) {
      const errs: Record<string, string> = await response.json();
      await alert(
        errs
          ? Object.keys(errs)
              .map(k => `${k}: ${errs[k]}`)
              .join('\n')
          : 'Invalid setup',
      );
      if (response.status === 403) {
        // 403 FORBIDDEN closes this modal because challenges to the recipient
        // will not be accepted.  see friend() in controllers/Setup.scala
        this.closeModal?.();
      }
    } else if (redirected) {
      location.href = url;
    } else {
      this.loading = false;
      this.closeModal?.();
    }
  };
}
