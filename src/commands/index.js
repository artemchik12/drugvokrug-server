'use strict';

const { handleLogin } = require('./login');
const { handleRelogin } = require('./relogin');
const { handleLogout } = require('./logout');
const { handleRegistration, handlePasswordRecovery } = require('./registration');
const { handleRegion } = require('./region');
const {
  handleCanWriteLiveChat,
  handleCanChangePhoto,
  handleMarkOption,
  handlePaidServices,
  handleNotificationList,
  handleFamiliarList,
  handleEventList,
  handleBtFind,
  handleSendSettingToServer,
} = require('./misc');
const {
  handleGetSettings,
  handleGetOption,
  handleRating,
  handleLastBtMeetings,
  handleStickersCategories,
  handlePresentCategoryList,
} = require('./bootstrap');
const { handleFriendsList, handleAddToFriends } = require('./friends');
const { handleGuestList } = require('./guests');
const { handleUserProfile, handleSendUserInfo, handleUserSmallInfo } = require('./profile');
const { handleOnlineStatus } = require('./status');
const { handleMessageSend, handleMessagesHistory, handleLastMessages, handleMessageWork } = require('./messaging');
const { handleSearch } = require('./discovery');
const { handleLiveList, handleSendMessageToLiveChat } = require('./live');

/**
 * Builds the CID -> handler map used by Session._handleCommand.
 * Handlers are `async (args, session) => responseArgsArray`.
 * Add new commands here as more of drug.vokrug.system.command.* gets traced.
 */
function buildRegistry() {
  const map = new Map();
  // Session
  map.set('2', handleLogin); // LoginCommand
  map.set('13', handleRelogin); // ReloginCommand
  map.set('3', handleLogout); // LogoutCommand
  map.set('1', handleRegistration); // RegistrationCommand
  map.set('38', handlePasswordRecovery); // PasswordRecoveryCommand
  map.set('115', handleRegion); // RegionCommand - fires immediately on connect, pre-login
  map.set('60', handlePaidServices); // PaidServicesCommand
  map.set('72', handleCanWriteLiveChat); // CanWriteLiveChatCommand
  map.set('73', handleCanChangePhoto); // CanChangePhotoCommand
  map.set('104', handleFamiliarList); // FamiliarListCommand
  map.set('108', handleMarkOption); // MarkOptionCommand
  map.set('111', handleNotificationList); // NotificationListCommand
  map.set('23', handleEventList); // EventListCommand
  map.set('4', handleBtFind); // BtFindCommand
  map.set('80', handleSendSettingToServer); // SendSettingToServerCommand
  // Post-login bootstrap (fired automatically by LoginService)
  map.set('81', handleGetSettings); // GetSettingsCommand - gates the real "login succeeded" signal
  map.set('107', handleGetOption); // GetOptionCommand
  map.set('26', handleRating); // RatingCommand
  map.set('36', handleLastBtMeetings); // LastBtMeetingsCommand
  map.set('126', handleStickersCategories); // StickersCategoriesCommand
  map.set('40', handlePresentCategoryList); // PresentCategoryListCommand
  // Profile / social graph
  map.set('31', handleUserProfile); // UserProfileCommand
  map.set('32', handleSendUserInfo); // SendUserInfoCommand
  map.set('51', handleUserSmallInfo); // UserSmallInfoCommand
  map.set('17', handleFriendsList); // FriendsListCommand
  map.set('15', handleAddToFriends); // AddToFriendsCommand
  map.set('77', handleGuestList); // GuestListCommand
  map.set('136', handleOnlineStatus); // OnlineStatusCommand
  // Discovery / live feed ("эфир")
  map.set('27', handleLiveList); // LiveListCommand
  map.set('55', handleSendMessageToLiveChat); // SendMessageToLiveChatCommand
  map.set('14', handleSearch); // SearchCommand
  // Messaging
  map.set('8', handleMessageSend); // MessageSendCommand
  map.set('12', handleMessagesHistory); // MessagesHistoryCommand
  map.set('10', handleLastMessages); // Last(In|Out)comingMessagesCommand
  map.set('33', handleMessageWork); // MessageWorkCommand
  return map;
}

module.exports = { buildRegistry };
