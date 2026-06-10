export function userCanAccessHrChats(locals: { isHr?: unknown }): boolean {
  return locals.isHr === true;
}

export function chatVisibilityWhere(canAccessHrChats: boolean) {
  return canAccessHrChats ? {} : { isHr: false };
}

export function canAccessChat(chat: { isHr?: boolean | null }, canAccessHrChats: boolean): boolean {
  return !chat.isHr || canAccessHrChats;
}
