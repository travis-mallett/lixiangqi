export interface MsgOpts {
  data: MsgData;
}
export interface MsgData {
  me: Me;
  contacts: Contact[];
  names: RealNames;
  organization?: Organization;
  convo?: Convo;
}
export type RealNames = Record<UserId, string>;
export interface Contact {
  user: User;
  lastMsg: LastMsg;
}
export interface User extends LightUser {
  group?: boolean;
  online: boolean;
}
export interface Me extends User {
  bot: boolean;
}
export interface Poll {
  question: string;
  options: string[];
  multiple: boolean;
  votes: { user: string; choices: number[] }[];
  ended: boolean;
}
export interface LinkPreview {
  date?: number;
  url: string;
  title: string;
  description: string;
}
export interface MsgCard {
  poll?: Poll;
  contact?: string;
  preview?: LinkPreview;
}
export interface Msg {
  card?: MsgCard;
  id: string;
  user: string;
  text: string;
  date: Date;
  revision: number;
  reply?: { id: string; user: string; text: string };
  attachments?: string[];
  forwarded?: boolean;
  editedAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  deleted?: boolean;
  deletedAt?: Date;
  pinnedAt?: Date;
  history: { text: string; date: Date }[];
  reactions: { user: string; emoji: string }[];
  canEditUntil?: Date;
  canDeleteUntil?: Date;
  pending?: 'sending' | 'failed';
  nonce?: string;
}
export interface Receipt {
  id: string;
  deliveredAt?: number;
  readAt?: number;
}
export interface LastMsg extends Msg {
  read: boolean;
}
export interface Convo {
  canModerate?: boolean;
  members?: User[];
  admins?: string[];
  description?: string;
  user: User;
  msgs: Msg[];
  relations: Relations;
  postable: boolean;
  pinned: Msg[];
  modDetails?: ModDetails;
}

export interface ModDetails {
  kid: boolean;
  openInbox: boolean;
}

export interface Relations {
  in?: boolean;
  out?: boolean;
}

export interface Daily {
  date: Date;
  msgs: Msg[][];
}

export interface Search {
  input: string;
  result?: SearchResult;
}
export interface SearchResult {
  contacts: Contact[];
  friends: User[];
  users: User[];
}

export type Pane = 'side' | 'convo';

export type Redraw = () => void;

export interface Folder {
  id: string;
  name: string;
  chats: string[];
}
export interface ChatState {
  archive?: number;
  mute?: boolean;
  pin?: boolean;
  unread?: boolean;
  mentions?: boolean;
}
export interface Organization {
  states: Record<string, ChatState>;
  folders: Folder[];
}
