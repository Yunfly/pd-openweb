export function getAppNavigateUrl(appId, pcNaviStyle) {
  const storage = JSON.parse(localStorage.getItem(`mdAppCache_${md.global.Account.accountId}_${appId}`));
  if (storage) {
    const { lastGroupId, lastWorksheetId, lastViewId } = storage;
    if (pcNaviStyle === 2) {
      return lastGroupId ? `/app/${appId}/${lastGroupId}?from=insite` : `/app/${appId}`;
    }
    if (lastGroupId && lastWorksheetId && lastViewId) {
      return `/app/${appId}/${[lastGroupId, lastWorksheetId, lastViewId].join('/')}?from=insite`;
    } else if (lastGroupId && lastWorksheetId) {
      return `/app/${appId}/${[lastGroupId, lastWorksheetId].join('/')}?from=insite`;
    } else if (lastGroupId) {
      return `/app/${appId}/${lastGroupId}?from=insite`;
    } else {
      return `/app/${appId}`;
    }
  } else {
    return `/app/${appId}`;
  }
}
