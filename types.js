// @flow

export type NotifPayload = {
  data: {
    commentId: ?string,
    productUuid: ?string,
    senderName: ?string,
    text: ?string,
  },
  notifI18n: string,
  targetUser: string,
  sourceUser: string,
  triggeredBy: string,
  triggeredType: string,
  onlyPush: ?boolean,
  message: ?string,
};