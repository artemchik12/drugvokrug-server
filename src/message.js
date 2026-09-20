'use strict';

const { LongArr, BoolArr, Seq } = require('./wire');

// MessageType.TEXT == 0 (drug.vokrug.objects.business.message.MessageType).
const MESSAGE_TYPE_TEXT = 0n;

/**
 * Builds the wire Seq for one message, ported from
 * drug.vokrug.objects.business.message.Message.a(Object) /
 * TextMessage's constructor chain. Traced field order (see README "Message
 * wire format" for the full derivation):
 *
 *   Seq([
 *     LongArr([messageId, otherUserId, serverTimestampMs, messageType]),
 *     BoolArr([readByViewer, alwaysTrueFlag]),
 *     bodyText   // only for MessageType.TEXT - other types carry a
 *                // different payload here (PRESENT/STICKER/PHOTO/...),
 *                // not implemented
 *   ])
 *
 * `otherUserId` is *from the viewing user's perspective* - the sender for
 * an incoming message, the recipient for an outgoing one (this is what the
 * client's `Message.d()` / OrangeMenu.Identifiable.d() represents).
 *
 * The second BoolArr flag (`bool2` in Message.a) wasn't traced beyond its
 * involvement in computing the read-flag; sending `true` for it is the
 * conservative default (see commands/messaging.js for where this is used).
 */
function messageSeq(row, viewerUserId) {
  const otherUserId = row.fromId === viewerUserId ? row.toId : row.fromId;
  return new Seq([
    new LongArr([row.id, otherUserId, row.createdAt, MESSAGE_TYPE_TEXT]),
    new BoolArr([row.isRead === 1, true]),
    row.body,
  ]);
}

module.exports = { messageSeq, MESSAGE_TYPE_TEXT };
