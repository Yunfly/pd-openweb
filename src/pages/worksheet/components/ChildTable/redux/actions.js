import { handleSortRows, postWithToken, download } from 'worksheet/util';
import worksheetAjax from 'src/api/worksheet';

const PAGE_SIZE = 200;

export const initRows = rows => ({ type: 'INIT_ROWS', rows });

export const resetRows = () => {
  return (dispatch, getState) => {
    dispatch(initRows(getState().originRows));
    return Promise.resolve();
  };
};

export const clearAndSetRows = rows => {
  return (dispatch, getState) => {
    dispatch({ type: 'CLEAR_AND_SET_ROWS', rows, deleted: getState().rows.map(r => r.rowid) });
  };
};

export const setOriginRows = rows => ({ type: 'LOAD_ROWS', rows });

export const addRow = (row, insertRowId) => ({ type: 'ADD_ROW', row, rowid: row.rowid, insertRowId });

export const deleteRow = rowid => ({ type: 'DELETE_ROW', rowid });

export const updateRow = ({ rowid, value }) => {
  return dispatch => {
    dispatch({
      type: 'UPDATE_ROW',
      rowid,
      value: { ...value, empty: false },
    });
    return Promise.resolve();
  };
};

export const loadRows = ({
  worksheetId,
  recordId,
  isCustomButtonFillRecord,
  controlId,
  pageIndex = 1,
  getWorksheet,
  from,
  callback = () => {},
}) => {
  const isPrintShare = /\/printshare/.test(location.pathname);
  const isPublicQuery = /\/public\/query/.test(location.pathname);
  return (dispatch, getState) => {
    const args = {
      worksheetId,
      rowId: recordId,
      controlId: controlId,
      getWorksheet,
      pageIndex,
      pageSize: PAGE_SIZE,
      getType: from === 21 ? from : undefined,
    };
    const isShare =
      /\/public\/record/.test(location.pathname) ||
      /\/public\/view/.test(location.pathname) ||
      /\/public\/workflow/.test(location.pathname);
    if (isShare) {
      args.shareId = (location.href.match(/\/public\/(record|view|workflow)\/(\w{24})/) || '')[2];
    }
    if (isPrintShare) {
      args.shareId = (location.pathname.match(/.*\/printshare\/(\w{24})/) || '')[1];
    }
    if (isPublicQuery) {
      args.shareId = (location.pathname.match(/.*\/public\/query\/(\w{24})/) || '')[1];
    }
    worksheetAjax.getRowRelationRows(args).then(res => {
      const rows = (res.data || []).map((row, i) => ({ ...row, allowedit: true, addTime: i }));
      dispatch({ type: 'LOAD_ROWS', rows });
      dispatch(initRows(rows));
      if (isCustomButtonFillRecord && rows.length) {
        dispatch(updateRow(rows[0].rowid, rows[0]));
      }
      callback(res);
    });
  };
};

export const addRows = rows => ({ type: 'ADD_ROWS', rows });

export const sortRows = ({ control, isAsc }) => {
  return (dispatch, getState) => {
    const { rows } = getState();
    dispatch({ type: 'INIT_ROWS', rows: handleSortRows(rows, control, isAsc) });
  };
};

export const exportSheet = ({ worksheetId, rowId, controlId, fileName, onDownload = () => {} } = {}) => {
  return async () => {
    try {
      const res = await postWithToken(
        `${md.global.Config.WorksheetDownUrl}/ExportExcel/DetailTable`,
        { worksheetId, tokenType: 8 },
        {
          worksheetId,
          rowId,
          controlId,
          pageIndex: 1,
          pageSize: 200,
        },
        {
          responseType: 'blob',
        },
      );
      onDownload();
      download(res.data, fileName);
    } catch (err) {
      alert(_l('导出失败！请稍候重试'), 2);
    }
  };
};
