import React, { useState } from 'react';
import PropTypes, { func } from 'prop-types';
import { autobind } from 'core-decorators';
import { v4 as uuidv4 } from 'uuid';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import styled from 'styled-components';
import moment from 'moment';
import { browserIsMobile, createElementFromHtml } from 'src/util';
import { RECORD_INFO_FROM } from 'worksheet/constants/enum';
import worksheetAjax from 'src/api/worksheet';
import RecordInfoContext from 'worksheet/common/recordInfo/RecordInfoContext';
import Skeleton from 'src/router/Application/Skeleton';
import { selectRecord } from 'src/components/recordCardListDialog';
import { mobileSelectRecord } from 'src/components/recordCardListDialog/mobile';
import { controlState } from 'src/components/newCustomFields/tools/utils';
import { FROM } from 'src/components/newCustomFields/tools/config';
import { WIDGETS_TO_API_TYPE_ENUM } from 'src/pages/widgetConfig/config/widget';
import { WORKSHEETTABLE_FROM_MODULE, SYSTEM_CONTROLS, SHEET_VIEW_HIDDEN_TYPES } from 'worksheet/constants/enum';
import {
  sortControlByIds,
  replaceByIndex,
  isRelateRecordTableControl,
  copySublistRow,
  parseAdvancedSetting,
  formatRecordToRelateRecord,
  handleSortRows,
  updateOptionsOfControls,
} from 'worksheet/util';
import ColumnHead from '../BaseColumnHead';
import RowHead from './ChildTableRowHead';
import MobileTable from './MobileTable';
import DataFormat from 'src/components/newCustomFields/tools/DataFormat';
import WorksheetTable from '../WorksheetTable/V2';
import RowDetail from './RowDetailModal';
import RowDetailMobile from './RowDetailMobileModal';
import * as actions from './redux/actions';
import _ from 'lodash';

const IconBtn = styled.span`
  color: #9e9e9e;
  display: inline-block;
  height: 28px;
  font-size: 20px;
  line-height: 28px;
  padding: 0 4px;
  border-radius: 5px;
  &:hover {
    background: #f7f7f7;
  }
`;
const isMobile = browserIsMobile();
const systemControls = SYSTEM_CONTROLS.map(c => ({ ...c, fieldPermission: '111' }));

function ExportButton(props) {
  const { exportSheet = () => {} } = props;
  const [loading, setLoading] = useState(false);
  return (
    <span
      data-tip={_l('导出Excel')}
      onClick={() => {
        if (loading) {
          return;
        }
        setLoading(true);
        exportSheet(() => setLoading(false));
      }}
    >
      {loading ? (
        <i
          className="icon icon-loading_button ThemeColor3"
          style={{
            fontSize: 16,
            margin: 5,
            display: 'inline-block',
            animation: 'rotate 0.6s infinite linear',
          }}
        ></i>
      ) : (
        <IconBtn className="Hand ThemeHoverColor3">
          <i className="icon icon-file_download" />
        </IconBtn>
      )}
    </span>
  );
}

ExportButton.propTypes = {
  exportSheet: func,
};

class ChildTable extends React.Component {
  static contextType = RecordInfoContext;
  static propTypes = {
    entityName: PropTypes.string,
    maxCount: PropTypes.number,
    recordId: PropTypes.string,
    projectId: PropTypes.string,
    control: PropTypes.shape({}),
    masterData: PropTypes.shape({}),
    registerCell: PropTypes.func,
    loadRows: PropTypes.func,
    initRows: PropTypes.func,
    addRow: PropTypes.func,
    updateRow: PropTypes.func,
    deleteRow: PropTypes.func,
    sortRows: PropTypes.func,
    resetRows: PropTypes.func,
    mobileIsEdit: PropTypes.bool,
  };

  static defaultProps = {
    maxCount: 200,
    masterData: { formData: [] },
  };

  constructor(props) {
    super(props);
    this.state = {
      controls: this.getControls(props),
      tempSheetColumnWidths: {},
      previewRowIndex: null,
      recordVisible: false,
      cellErrors: {},
      loading: !!props.recordId && !props.initSource,
    };
    this.state.sheetColumnWidths = this.getSheetColumnWidths();
    this.controls = props.controls;
    props.registerCell(this);
  }

  componentDidMount() {
    const { rows, control, recordId, initRowIsCreate = true, initRows } = this.props;
    this.updateDefsourceOfControl();
    if (recordId) {
      if (
        !rows.length &&
        _.isObject(control.value) &&
        control.value.action === 'clearAndSet' &&
        _.get(control, 'value.rows.length')
      ) {
        this.handleClearAndSetRows(
          control.value.rows.map(r => this.newRow(r, { isDefaultValue: true, isQueryWorksheetFill: true })),
        );
        this.setState({ loading: false });
      } else if (
        !rows.length &&
        _.isObject(control.value) &&
        (!_.isEmpty(_.get(control, 'value.updated')) || !_.isEmpty(_.get(control, 'value.deleted')))
      ) {
        initRows(control.value.rows);
        this.setState({ loading: false });
      } else {
        this.loadRows();
      }
    } else if (control.value) {
      try {
        const defaultRows =
          _.isObject(control.value) && _.isObject(control.value.rows) ? control.value.rows : JSON.parse(control.value);
        if (_.isArray(defaultRows)) {
          this.handleClearAndSetRows(
            defaultRows.map(r =>
              this.newRow(r, {
                isDefaultValue: true,
                isCreate: _.isUndefined(r.initRowIsCreate) ? initRowIsCreate : r.initRowIsCreate,
                isQueryWorksheetFill: true,
              }),
            ),
          );
        }
      } catch (err) {
        console.log(err);
      }
    }
    if (_.isFunction(control.addRefreshEvents)) {
      control.addRefreshEvents(control.controlId, this.refresh);
    }
    this.rowsCache = {};
    $(this.childTableCon).on('mouseenter', '.cell:not(.row-head)', this.handleMouseEnter);
    $(this.childTableCon).on('mouseleave', '.cell:not(.row-head)', this.handleMouseLeave);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  componentWillReceiveProps(nextProps) {
    const { initRows, resetRows, addRows, clearAndSetRows } = this.props;
    this.updateDefsourceOfControl(nextProps);
    const control = this.props.control;
    const nextControl = nextProps.control;
    const isAddRecord = !nextProps.recordId;
    const valueChanged = !_.isEqual(control.value, nextControl.value);
    if (nextProps.recordId !== this.props.recordId) {
      this.refresh(nextProps, { needResetControls: false });
    } else if (isAddRecord && valueChanged && typeof nextControl.value === 'undefined') {
      initRows([]);
    } else if (valueChanged && nextControl.value && nextControl.value.action === 'reset') {
      resetRows();
    } else if (valueChanged && nextControl.value && nextControl.value.action === 'clearAndSet') {
      this.handleClearAndSetRows(
        nextControl.value.rows.map(row =>
          this.newRow(row, { isCreate: true, isDefaultValue: nextControl.value.isDefault, isQueryWorksheetFill: true }),
        ),
      );
    } else if (valueChanged && nextControl.value && nextControl.value.action === 'append') {
      addRows(nextControl.value.rows.map(this.newRow));
    }
    if (
      nextControl.controlId !== control.controlId ||
      !_.isEqual(nextControl.showControls, control.showControls) ||
      !_.isEqual(
        (control.relationControls || []).map(a => a.fieldPermission),
        (nextControl.relationControls || []).map(a => a.fieldPermission),
      ) ||
      !_.isEqual(
        (control.relationControls || []).map(a => a.required),
        (nextControl.relationControls || []).map(a => a.required),
      )
    ) {
      this.setState({ controls: this.getControls(nextProps) });
    }
    // 重新渲染子表来适应新宽度
    if (
      nextProps.control.sideVisible !== this.props.control.sideVisible ||
      nextProps.control.formWidth !== this.props.control.formWidth
    ) {
      try {
        setTimeout(() => {
          if (this.worksheettable && this.worksheettable.current) {
            this.worksheettable.current.handleUpdate();
          }
        }, 100);
      } catch (err) {
        console.error(err);
      }
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (!_.isEqual(this.state, nextState)) {
      return true;
    }
    return (
      !_.isEqual(this.props.rows, nextProps.rows) ||
      !_.isEqual(this.props.mobileIsEdit, nextProps.mobileIsEdit) ||
      !_.isEqual(this.props.control.relationControls, nextProps.control.relationControls) ||
      !_.isEqual(this.props.control.fieldPermission, nextProps.control.fieldPermission)
    );
  }

  componentDidUpdate() {
    this.rowsCache = {};
  }

  componentWillUnmount() {
    const { control } = this.props;
    if (_.isFunction(control.addRefreshEvents)) {
      control.addRefreshEvents(control.controlId, undefined);
    }
    $(this.childTableCon).off('mouseenter', '.cell:not(.row-head)', this.handleMouseEnter);
    $(this.childTableCon).off('mouseleave', '.cell:not(.row-head)', this.handleMouseLeave);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  worksheettable = React.createRef();

  getControls(props, { newControls } = {}) {
    const {
      isWorkflow,
      control: { showControls = [], advancedSetting = {}, relationControls = [] },
      masterData,
      controls,
    } = props || this.props;
    let controlssorts = [];
    try {
      controlssorts = JSON.parse(advancedSetting.controlssorts);
    } catch (err) {}
    let result = sortControlByIds(newControls || controls, _.isEmpty(controlssorts) ? showControls : controlssorts).map(
      c => {
        const control = { ...c };
        const resetedControl = _.find(relationControls.concat(systemControls), { controlId: control.controlId });
        if (resetedControl) {
          control.required = resetedControl.required;
          control.fieldPermission = resetedControl.fieldPermission;
        }
        if (!_.find(showControls, scid => control.controlId === scid)) {
          control.fieldPermission = '000';
        } else {
          control.fieldPermission = replaceByIndex(control.fieldPermission || '111', 2, '1');
        }
        if (!isWorkflow) {
          control.controlPermissions = '111';
        } else {
          control.controlPermissions = replaceByIndex(control.controlPermissions || '111', 2, '1');
        }
        if (control.controlId === 'ownerid') {
          control.controlPermissions = '100';
        }
        return control;
      },
    );
    result = result.filter(
      c =>
        c &&
        !(
          window.isPublicWorksheet &&
          _.includes([WIDGETS_TO_API_TYPE_ENUM.USER_PICKER, WIDGETS_TO_API_TYPE_ENUM.DEPARTMENT], c.type)
        ),
    );
    return result;
  }

  getControl(controlId) {
    return _.find(this.state.controls, { controlId });
  }

  @autobind
  handleKeyDown(e) {
    if (e.ctrlKey && e.key === 'Enter' && this.childTableCon.querySelector('.cell.focus')) {
      e.preventDefault();
      e.stopPropagation();
      this.handleAddRowByLine();
    }
  }

  handleClearAndSetRows(rows) {
    const { control, clearAndSetRows } = this.props;
    const { controls = [] } = this.state;
    const sort = safeParse(control.advancedSetting.sorts)[0];
    if (sort && sort.controlId) {
      const sortControl = _.find(controls, c => c.controlId === sort.controlId);
      if (sortControl) {
        clearAndSetRows(handleSortRows(rows, sortControl, sort.isAsc));
        return;
      }
    }
    clearAndSetRows(rows);
  }

  updateDefsourceOfControl(nextProps) {
    const {
      recordId,
      control: { controlId },
      masterData,
    } = nextProps || this.props;
    const { controls } = this.state;
    this.setState({
      controls: controls.map(control => {
        if (control.type === 29 && control.sourceControlId === controlId) {
          try {
            control.advancedSetting = _.assign({}, control.advancedSetting, {
              defsource: JSON.stringify([
                {
                  staticValue: JSON.stringify([
                    JSON.stringify({
                      rowid: recordId,
                      ...[{}, ...masterData.formData.filter(c => c.type !== 34)].reduce((a = {}, b = {}) =>
                        Object.assign(a, {
                          [b.controlId]:
                            b.type === 29 && _.isObject(b.value) && b.value.records
                              ? JSON.stringify(
                                  // 子表使用双向关联字段作为默认值 RELATERECORD_OBJECT
                                  b.value.records.map(r => ({ sid: r.rowid, sourcevalue: JSON.stringify(r) })),
                                )
                              : b.value,
                        }),
                      ),
                    }),
                  ]),
                },
              ]),
            });
            return control;
          } catch (err) {}
        } else {
          return control;
        }
      }),
    });
  }

  loadRows(nextProps, { needResetControls } = {}) {
    const { control, recordId, masterData, loadRows, from } = nextProps || this.props;
    if (!recordId || !masterData) {
      return;
    }
    loadRows({
      getWorksheet: needResetControls,
      worksheetId: masterData.worksheetId,
      recordId,
      controlId: control.controlId,
      isCustomButtonFillRecord: control.isCustomButtonFillRecord,
      from,
      callback: res => {
        const state = { loading: false };
        if (needResetControls) {
          const newControls = (_.get(res, 'worksheet.template.controls') || _.get(res, 'template.controls')).concat(
            systemControls,
          );
          if (newControls && newControls.length) {
            state.controls = this.getControls(nextProps, { newControls });
          }
        }
        this.setState(state);
      },
    });
  }

  @autobind
  refresh(nextProps, { needResetControls = true } = {}) {
    this.setState({ loading: true, sortedControl: undefined });
    this.loadRows(nextProps, { needResetControls });
  }

  getShowColumns() {
    const { control } = this.props;
    const { controls } = this.state;
    const hiddenTypes = window.isPublicWorksheet ? [48] : [];
    return !controls.length
      ? [{}]
      : controls
          .filter(
            c =>
              _.find(control.showControls, scid => scid === c.controlId) &&
              c.type !== 34 &&
              controlState(c).visible &&
              !isRelateRecordTableControl(c) &&
              !_.includes(hiddenTypes.concat(SHEET_VIEW_HIDDEN_TYPES), c.type),
          )
          .map(c => _.assign({}, c));
  }

  getSheetColumnWidths(control) {
    control = control || this.props.control;
    const columns = this.getShowColumns();
    const result = {};
    let widths = [];
    try {
      widths = JSON.parse(control.advancedSetting.widths);
    } catch (err) {}
    columns.forEach((column, i) => {
      result[column.controlId] = widths[i];
    });
    return result;
  }

  @autobind
  newRow(defaultRow, { isDefaultValue, isCreate, isQueryWorksheetFill } = {}) {
    const tempRowId = !isDefaultValue ? `temp-${uuidv4()}` : `default-${uuidv4()}`;
    const row = this.rowUpdate({ row: defaultRow, rowId: tempRowId }, { isCreate, isQueryWorksheetFill });
    return { ...row, rowid: tempRowId, allowedit: true, addTime: new Date().getTime() };
  }

  copyRow(row) {
    const { addRow } = this.props;
    addRow(
      Object.assign({}, _.omit(copySublistRow(this.state.controls, row), ['updatedControlIds']), {
        rowid: `temp-${uuidv4()}`,
        allowedit: true,
        isCopy: true,
        addTime: new Date().getTime(),
      }),
      row.rowid,
    );
  }

  rowUpdate({ row, controlId, value, rowId } = {}, { isCreate = false, isQueryWorksheetFill = false } = {}) {
    const { masterData, projectId, recordId, searchConfig, rules = [] } = this.props;
    const asyncUpdateCell = (cid, newValue) => {
      this.handleUpdateCell(
        {
          control: this.getControl(cid),
          cell: {
            controlId: cid,
            value: newValue,
          },
          row: { rowid: rowId || (row || {}).rowid },
        },
        {
          isQueryWorksheetFill,
          updateSuccessCb: needUpdateRow => {
            this.updateSheetRow(needUpdateRow);
          },
        },
      );
    };
    const formdata = new DataFormat({
      data: this.state.controls.map(c => {
        let controlValue = (row || {})[c.controlId];
        if (_.isUndefined(controlValue) && (isCreate || !row)) {
          controlValue = c.value;
        }
        return {
          ...c,
          isQueryWorksheetFill,
          value: controlValue,
        };
      }),
      isCreate: isCreate || !row,
      from: FROM.NEWRECORD,
      rules,
      searchConfig,
      projectId,
      masterData,
      masterRecordRowId: recordId,
      onAsyncChange: changes => {
        if (!_.isEmpty(changes.controlIds)) {
          changes.controlIds.forEach(cid => {
            asyncUpdateCell(cid, changes.value);
          });
        } else if (changes.controlId) {
          asyncUpdateCell(changes.controlId, changes.value);
        }
      },
    });
    if (controlId) {
      formdata.updateDataSource({ controlId, value });
    }
    return [
      {
        ...(row || {}),
        rowid: row ? row.rowid : rowId,
        updatedControlIds: _.uniqBy(((row && row.updatedControlIds) || []).concat(formdata.getUpdateControlIds())),
      },
      ...formdata.getDataSource(),
    ].reduce((a = {}, b = {}) => Object.assign(a, { [b.controlId]: b.value }));
  }

  updateSheetRow(row) {
    if (isMobile) {
      this.handleRowDetailSave(row);
    } else if (_.isFunction(_.get(this, 'worksheettable.current.table.updateSheetRow'))) {
      this.worksheettable.current.table.updateSheetRow({
        ...row,
        allowedit: true,
        allowedelete: true,
      });
    }
  }

  @autobind
  handleAddRowByLine() {
    const { addRow, rows } = this.props;
    this.updateDefsourceOfControl();
    const row = this.newRow();
    addRow(row);
    setTimeout(() => {
      try {
        this.worksheettable.current.table.refs.setScroll(0, rows.length + 1 > 15 ? 100000 : 0);
        setTimeout(() => {
          const activeCell = this.worksheettable.current.table.refs.dom.current.querySelector(
            '.cell.row-' + rows.length + '.canedit',
          );
          if (activeCell) {
            activeCell.click();
          }
        }, 100);
      } catch (err) {}
    }, 100);
  }

  @autobind
  handleAddRowsFromRelateRecord(batchAddControls) {
    const { addRows, entityName, control } = this.props;
    const { controls } = this.state;
    const relateRecordControl = batchAddControls[0];
    if (!relateRecordControl) {
      return;
    }
    this.updateDefsourceOfControl();
    const tempRow = this.newRow();
    const relateRecord = isMobile ? mobileSelectRecord : selectRecord;
    relateRecord({
      entityName,
      canSelectAll: true,
      multiple: true,
      control: relateRecordControl,
      controlId: relateRecordControl.controlId,
      parentWorksheetId: control.dataSource,
      allowNewRecord: false,
      viewId: relateRecordControl.viewId,
      relateSheetId: relateRecordControl.dataSource,
      formData: controls.map(c => ({ ...c, value: tempRow[c.controlId] })).concat(this.props.masterData.formData),
      onOk: selectedRecords => {
        addRows(
          selectedRecords.map(selectedRecord => {
            const row = this.rowUpdate({
              row: this.newRow(),
              controlId: relateRecordControl.controlId,
              value: JSON.stringify(formatRecordToRelateRecord(relateRecordControl.relationControls, [selectedRecord])),
            });
            return row;
          }),
        );
      },
    });
  }

  @autobind
  handleUpdateCell({ control, cell, row = {} }, options) {
    const { rows, updateRow } = this.props;
    const { controls } = this.state;
    const rowData = _.find(rows, r => r.rowid === row.rowid);
    if (!rowData) {
      return;
    }
    let { value } = cell;
    const newRow = this.rowUpdate(
      { row: rowData, controlId: cell.controlId, value },
      {
        ...options,
        control,
      },
    );
    newRow.isEdited = true;
    function update() {
      this.rowsCache[row.rowid] = { ...(this.rowsCache[row.rowid] || {}), [cell.controlId]: cell.value };
      if (_.isFunction(options.updateSuccessCb)) {
        options.updateSuccessCb(newRow);
      }
      updateRow({ rowid: row.rowid, value: newRow });
    }
    // 处理新增自定义选项
    if (
      _.includes([WIDGETS_TO_API_TYPE_ENUM.MULTI_SELECT, WIDGETS_TO_API_TYPE_ENUM.DROP_DOWN], control.type) &&
      /{/.test(value)
    ) {
      const newOption = {
        index: control.options.length + 1,
        isDeleted: false,
        key: _.last(JSON.parse(value)),
        ...JSON.parse(_.last(JSON.parse(value))),
      };
      const newControl = { ...control, options: _.uniqBy([...control.options, newOption], 'key') };
      this.setState(
        {
          controls: controls.map(c => (c.controlId === control.controlId ? newControl : c)),
        },
        update,
      );
      return;
    }
    update.apply(this);
  }

  @autobind
  handleRowDetailSave(row, updatedControlIds) {
    const { updateRow, addRow } = this.props;
    const { previewRowIndex, controls } = this.state;
    const newControls = updateOptionsOfControls(
      controls.map(c => ({ ...{}, ...c, value: row[c.controlId] })),
      row,
    );
    this.setState(
      {
        controls: controls.map(c => {
          const newControl = _.find(newControls, { controlId: c.controlId });
          return newControl ? { ...newControl, value: c.value } : c;
        }),
      },
      () => {
        row.updatedControlIds = _.isEmpty(row.updatedControlIds)
          ? updatedControlIds
          : _.uniqBy(row.updatedControlIds.concat(updatedControlIds));
        row.updatedControlIds = row.updatedControlIds.concat(
          controls
            .filter(c => _.find(updatedControlIds, cid => ((c.advancedSetting || {}).defsource || '').includes(cid)))
            .map(c => c.controlId),
        );
        if (previewRowIndex > -1) {
          updateRow({ rowid: row.rowid, value: row });
        } else {
          addRow(row);
        }
      },
    );
  }

  @autobind
  handleSwitch({ prev, next }) {
    const { previewRowIndex } = this.state;
    let newRowIndex;
    if (prev) {
      newRowIndex = previewRowIndex - 1;
    } else {
      newRowIndex = previewRowIndex + 1;
    }
    this.openDetail(newRowIndex);
  }

  @autobind
  openDetail(index) {
    this.setState({
      previewRowIndex: index,
      recordVisible: true,
    });
  }

  @autobind
  handleClearCellError(key) {
    this.setState({
      error: false,
      cellErrors: _.omit(this.state.cellErrors, [key]),
    });
  }

  @autobind
  handleUniqueValidate(controlId, value, rowId) {
    const { rows } = this.props;
    return !_.find(rowId ? rows.filter(row => row.rowid !== rowId) : rows, row => row[controlId] === value);
  }

  @autobind
  handleMouseEnter(e) {
    const cell = $(e.target).closest('.cell')[0];
    if (!cell) {
      return;
    }
    $(cell).addClass('errorActive');
    const { rows } = this.props;
    const { cellErrors } = this.state;
    const columns = this.getShowColumns();
    const hasError = /cellControlErrorStatus/.test(cell.className);
    const cellIsEditing = /iseditting/.test(cell.className);
    const rowIndex = Number(cell.className.match(/ row-([0-9]+) /)[1]);
    const columnIndex = Number(cell.className.match(/ col-([0-9]+) /)[1]);
    const rowId = (rows[rowIndex] || {}).rowid;
    const controlId = (columns[columnIndex - 1] || {}).controlId;
    if (hasError && !cellIsEditing && rowId && controlId) {
      const error = cellErrors[rowId + '-' + controlId];
      if (error) {
        const errorEle = createElementFromHtml(`<div
            class="mdTableErrorTip"
            style="
              position: absolute;
              font-size: 12px;
              padding: 0px 8px;
              height: 26px;
              line-height: 26px;
              white-space: nowrap;
              background: #f44336;
              zIndex: 2;
              color: #fff";
          >
            ${error}
          </div>`);
        cell.parentElement.appendChild(errorEle);
        const top =
          cell.offsetTop +
          (/row-0/.test(cell.getAttribute('class')) ? cell.offsetHeight - 1 : -1 * errorEle.offsetHeight);
        const left = cell.offsetLeft;
        errorEle.style.top = top + 'px';
        errorEle.style.left = left + 'px';
      }
    }
  }
  @autobind
  handleMouseLeave() {
    $('.mdTableErrorTip').remove();
    $('.cell').removeClass('errorActive');
  }

  render() {
    const {
      isWorkflow,
      maxCount,
      from,
      recordId,
      projectId,
      viewId,
      control,
      rows,
      deleteRow,
      sortRows,
      exportSheet,
      mobileIsEdit,
      entityName,
      rules,
      appId,
      searchConfig,
      sheetSwitchPermit,
    } = this.props;
    let { allowadd, allowcancel, allowedit, batchcids, allowsingle } = parseAdvancedSetting(control.advancedSetting);
    const {
      loading,
      tempSheetColumnWidths,
      previewRowIndex,
      sheetColumnWidths,
      sortedControl,
      cellErrors,
      recordVisible,
      controls,
    } = this.state;
    const batchAddControls = batchcids.map(id => _.find(controls, { controlId: id })).filter(_.identity);
    const addRowFromRelateRecords = !!batchAddControls.length;
    const allowAddByLine =
      (_.isUndefined(_.get(control, 'advancedSetting.allowsingle')) && !addRowFromRelateRecords) || allowsingle;
    let allowExport = _.get(control, 'advancedSetting.allowexport');
    allowExport = _.isUndefined(allowExport) || allowExport === '1';
    const controlPermission = controlState(control, from);
    const tableRows = rows.map(row => (!/^temp/.test(row.rowid) ? { ...row, allowedit } : row));
    const disabled = !controlPermission.editable || control.disabled;
    const noColumns = !controls.length;
    const columns = this.getShowColumns();
    const disabledNew = tableRows.length === maxCount || noColumns || disabled || !allowadd;
    const RowDetailComponent = isMobile ? RowDetailMobile : RowDetail;
    const fullShowTable = tableRows.length <= 15;
    let tableHeight = ((fullShowTable ? tableRows.length : 15) + 1) * 34;
    if (tableRows.length === 1) {
      tableHeight += 26;
    }
    if (!columns.length) {
      return <div className="Gray_9e">{_l('没有支持填写的字段')}</div>;
    }
    return (
      <div className="childTableCon" ref={con => (this.childTableCon = con)} onClick={e => e.stopPropagation()}>
        {this.state.error && <span className="errorTip"> {_l('请正确填写%0', control.controlName)} </span>}
        <div className="operates">
          {allowExport &&
            recordId &&
            from !== RECORD_INFO_FROM.DRAFT &&
            !control.isCustomButtonFillRecord &&
            !_.get(window, 'shareState.shareId') && (
              <ExportButton
                exportSheet={cb =>
                  exportSheet({
                    worksheetId: this.props.masterData.worksheetId,
                    rowId: recordId,
                    controlId: control.controlId,
                    fileName: `${((_.last([...document.querySelectorAll('.recordTitle')]) || {}).innerText || '').slice(
                      0,
                      200,
                    )} ${control.controlName}${moment().format('YYYYMMDD HHmmss')}`.trim(),
                    onDownload: cb,
                  })
                }
              />
            )}
        </div>
        {!isMobile && !loading && (
          <div style={{ height: tableHeight }}>
            <WorksheetTable
              tableType="classic"
              isSubList
              rules={rules}
              height={tableHeight}
              fromModule={WORKSHEETTABLE_FROM_MODULE.SUBLIST}
              viewId={viewId}
              scrollBarHoverShow
              ref={this.worksheettable}
              setHeightAsRowCount={fullShowTable}
              forceScrollOffset={fullShowTable && { height: true }}
              clickEnterEditing
              cellErrors={cellErrors}
              clearCellError={this.handleClearCellError}
              cellUniqueValidate={this.handleUniqueValidate}
              fixedColumnCount={0}
              lineEditable={!disabled}
              noRenderEmpty
              rowHeight={34}
              worksheetId={control.dataSource}
              projectId={projectId}
              appId={appId}
              columns={columns}
              controls={controls}
              data={tableRows.length === 1 ? tableRows.concat({ isSubListFooter: true }) : tableRows}
              sheetColumnWidths={{ ...sheetColumnWidths, ...tempSheetColumnWidths }}
              rowHeadWidth={75}
              sheetSwitchPermit={sheetSwitchPermit}
              masterFormData={() => this.props.masterData.formData}
              masterData={() => this.props.masterData}
              getRowsCache={() => this.rowsCache}
              renderRowHead={args => (
                <RowHead
                  {...args}
                  row={rows[args.rowIndex]}
                  allowAdd={allowadd}
                  allowCancel={allowcancel}
                  changeSheetLayoutVisible={control.isCharge && !_.isEmpty(tempSheetColumnWidths)}
                  disabled={disabled}
                  onOpen={this.openDetail}
                  onDelete={() => deleteRow(args.row.rowid)}
                  onCopy={() => {
                    if (disabledNew) {
                      alert(_l('已超过子表最大行数'), 2);
                      return;
                    }
                    this.copyRow(args.row);
                  }}
                  saveSheetLayout={({ closePopup }) => {
                    const newWidths = JSON.stringify(
                      columns.map(c => ({ ...sheetColumnWidths, ...tempSheetColumnWidths }[c.controlId] || 160)),
                    );
                    const newControl = {
                      ...control,
                      advancedSetting: {
                        ...control.advancedSetting,
                        widths: newWidths,
                      },
                    };
                    worksheetAjax
                      .editWorksheetControls({
                        worksheetId: this.props.masterData.worksheetId,
                        controls: [
                          { ..._.pick(newControl, ['controlId', 'advancedSetting']), editattrs: ['advancedSetting'] },
                        ],
                      })
                      .then(res => {
                        if (res.data) {
                          closePopup();
                          this.setState({
                            tempSheetColumnWidths: {},
                            sheetColumnWidths: this.getSheetColumnWidths(newControl),
                          });
                          if (_.isFunction(_.get(this, 'context.updateWorksheetControls'))) {
                            _.get(
                              this,
                              'context.updateWorksheetControls',
                            )(res.data.controls.filter(c => c.controlId === control.controlId));
                          }
                        }
                      });
                  }}
                  resetSehetLayout={() => {
                    this.setState({ tempSheetColumnWidths: {} });
                  }}
                />
              )}
              renderColumnHead={({ ...rest }) => {
                const { control } = rest;
                return (
                  <ColumnHead
                    showRequired
                    isAsc={
                      sortedControl && sortedControl.controlId === control.controlId ? sortedControl.isAsc : undefined
                    }
                    changeSort={sortType => {
                      sortRows({ control, isAsc: sortType });
                      this.setState({
                        sortedControl: _.isUndefined(sortType)
                          ? undefined
                          : {
                              controlId: control.controlId,
                              isAsc: sortType,
                            },
                      });
                    }}
                    {...rest}
                  />
                );
              }}
              updateCell={this.handleUpdateCell}
              onColumnWidthChange={(controlId, value) => {
                this.setState({
                  tempSheetColumnWidths: { ...tempSheetColumnWidths, [controlId]: value },
                });
              }}
            />
          </div>
        )}
        {isMobile && !loading && (
          <MobileTable
            sheetSwitchPermit={sheetSwitchPermit}
            allowcancel={allowcancel}
            allowadd={allowadd}
            disabled={disabled}
            rows={tableRows}
            controls={columns}
            onOpen={this.openDetail}
            isEdit={mobileIsEdit}
            onDelete={deleteRow}
          />
        )}
        {loading && (
          <div style={{ padding: 10 }}>
            <Skeleton
              style={{ flex: 1 }}
              direction="column"
              widths={['30%', '40%', '90%', '60%']}
              active
              itemStyle={{ marginBottom: '10px' }}
            />
          </div>
        )}
        {isMobile ? (
          <div className="operate valignWrapper" style={{ width: 'max-content' }}>
            {isMobile && !disabledNew && addRowFromRelateRecords && (
              <span
                className="addRowByDialog h5 flex ellipsis"
                onClick={() => this.handleAddRowsFromRelateRecord(batchAddControls)}
              >
                <i className="icon icon-done_all mRight5 Font16"></i>
                {_l('选择%0', batchAddControls[0] && batchAddControls[0].controlName)}
              </span>
            )}
            {isMobile && mobileIsEdit && !disabledNew && allowAddByLine && (
              <span
                className="addRowByLine h5 flex"
                onClick={() => {
                  this.handleAddRowByLine();
                  this.setState({ previewRowIndex: tableRows.length, recordVisible: true });
                }}
              >
                <i className="icon icon-plus mRight5 Font16"></i>
                {_l('添加')}
              </span>
            )}
          </div>
        ) : (
          <div className="operate">
            {!isMobile && !disabledNew && addRowFromRelateRecords && (
              <span className="addRowByDialog" onClick={() => this.handleAddRowsFromRelateRecord(batchAddControls)}>
                <i className="icon icon-done_all mRight5 Font16"></i>
                {_l('选择%0', batchAddControls[0] && batchAddControls[0].controlName)}
              </span>
            )}
            {!isMobile && !disabledNew && allowAddByLine && (
              <span className="addRowByLine" onClick={this.handleAddRowByLine}>
                <i className="icon icon-plus mRight5 Font16"></i>
                {_l('添加一行')}
              </span>
            )}
          </div>
        )}
        {recordVisible && (
          <RowDetailComponent
            isWorkflow
            ignoreLock={(tableRows[previewRowIndex] || {}).isEdited}
            visible
            aglinBottom={!!recordId}
            from={from}
            worksheetId={control.dataSource}
            projectId={projectId}
            appId={appId}
            searchConfig={searchConfig}
            sheetSwitchPermit={sheetSwitchPermit}
            controlName={control.controlName}
            title={
              previewRowIndex > -1 ? `${control.controlName}#${previewRowIndex + 1}` : _l('创建%0', control.controlName)
            }
            disabled={disabled || (!/^temp/.test(_.get(tableRows, `${previewRowIndex}.rowid`)) && !allowedit)}
            mobileIsEdit={mobileIsEdit}
            allowDelete={/^temp/.test(_.get(tableRows, `${previewRowIndex}.rowid`)) || allowcancel}
            controls={controls}
            data={previewRowIndex > -1 ? tableRows[previewRowIndex] || {} : this.newRow()}
            switchDisabled={{ prev: previewRowIndex === 0, next: previewRowIndex === tableRows.length - 1 }}
            getMasterFormData={() => this.props.masterData.formData}
            handleUniqueValidate={this.handleUniqueValidate}
            onSwitch={this.handleSwitch}
            onSave={this.handleRowDetailSave}
            onDelete={deleteRow}
            onClose={() => this.setState({ recordVisible: false })}
            onRulesLoad={rules => {
              this.rules = rules;
            }}
          />
        )}
      </div>
    );
  }
}

const mapStateToProps = state => ({
  rows: state.rows,
  lastAction: state.lastAction,
});

const mapDispatchToProps = dispatch => ({
  loadRows: bindActionCreators(actions.loadRows, dispatch),
  setOriginRows: bindActionCreators(actions.setOriginRows, dispatch),
  resetRows: bindActionCreators(actions.resetRows, dispatch),
  initRows: bindActionCreators(actions.initRows, dispatch),
  addRow: bindActionCreators(actions.addRow, dispatch),
  addRows: bindActionCreators(actions.addRows, dispatch),
  updateRow: bindActionCreators(actions.updateRow, dispatch),
  deleteRow: bindActionCreators(actions.deleteRow, dispatch),
  sortRows: bindActionCreators(actions.sortRows, dispatch),
  clearAndSetRows: bindActionCreators(actions.clearAndSetRows, dispatch),
  exportSheet: bindActionCreators(actions.exportSheet, dispatch),
});

export default connect(mapStateToProps, mapDispatchToProps)(ChildTable);
