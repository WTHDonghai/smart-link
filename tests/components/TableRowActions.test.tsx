import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableRowActions } from '../../src/components/common/TableRowActions';

describe('TableRowActions 通用表格行操作控件', () => {
  it('默认状态下正确渲染保存和删除按钮', () => {
    const html = renderToStaticMarkup(
      <TableRowActions onSave={() => {}} onDelete={() => {}} />
    );

    expect(html).toContain('保存');
    expect(html).toContain('删除');
    expect(html).toContain('button');
  });

  it('当 isUnsaved 为 true 时渲染待保存高亮样式与文案', () => {
    const html = renderToStaticMarkup(
      <TableRowActions
        onSave={() => {}}
        onDelete={() => {}}
        isUnsaved={true}
        unsavedLabel="待保存"
      />
    );

    expect(html).toContain('待保存');
    expect(html).toContain('ring-2');
    expect(html).toContain('ring-[#004ac6]/40');
  });

  it('当 isSaving 为 true 时渲染保存中 Loading 旋转图标与禁用态', () => {
    const html = renderToStaticMarkup(
      <TableRowActions
        onSave={() => {}}
        onDelete={() => {}}
        isSaving={true}
        savingLabel="保存中..."
      />
    );

    expect(html).toContain('保存中...');
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled');
  });

  it('当 canDelete 为 false 时不渲染删除按钮', () => {
    const html = renderToStaticMarkup(
      <TableRowActions
        onSave={() => {}}
        onDelete={() => {}}
        canDelete={false}
      />
    );

    expect(html).toContain('保存');
    expect(html).not.toContain('删除');
  });

  it('支持传入自定义尺寸 (size="md" 时渲染 h-8，size="sm" 时渲染 h-7.5)', () => {
    const htmlMd = renderToStaticMarkup(
      <TableRowActions onSave={() => {}} onDelete={() => {}} size="md" />
    );
    expect(htmlMd).toContain('h-8');

    const htmlSm = renderToStaticMarkup(
      <TableRowActions onSave={() => {}} onDelete={() => {}} size="sm" />
    );
    expect(htmlSm).toContain('h-7.5');
  });

  it('支持插入 children 扩展按钮', () => {
    const html = renderToStaticMarkup(
      <TableRowActions onSave={() => {}}>
        <span data-testid="custom-action">配置模板</span>
      </TableRowActions>
    );

    expect(html).toContain('配置模板');
    expect(html).toContain('保存');
  });
});
