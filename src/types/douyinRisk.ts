/** 抖音页面风控规则的首个命中证据；不以可见性改变现有拦截结果。 */
export type DouyinRiskMatch =
  | { source: 'page-url' | 'frame-url' | 'url'; matched: string }
  | {
      source: 'dom';
      selector: string;
      tagName: string;
      elementId: string;
      className: string;
      src: string | null;
      visible: boolean;
      snippet: string;
    }
  | {
      source: 'title' | 'body';
      matched: string;
      snippet: string;
      textSource?: 'innerText' | 'textContent';
    };

export interface DouyinPageRiskEvidence {
  origin: 'page';
  pageUrl: string;
  frameUrl: string;
  /** null 表示在遍历 Frame 前，主页面 URL 已命中。 */
  frameIndex: number | null;
  match: DouyinRiskMatch;
}

export interface DouyinResponseRiskContext {
  apiUrl: string;
  httpStatus: number;
  method?: string;
}

export interface DouyinResponseRiskEvidence extends DouyinResponseRiskContext {
  origin: 'api-response';
  businessCode?: string | number;
  match: {
    source: 'response-body';
    /** (JSON) 表示字段值为序列化的 JSON；$raw 表示在原始响应文本中命中。 */
    fieldPath: string;
    matched: string;
    snippet: string;
  };
}

export interface DouyinExceptionRiskEvidence {
  origin: 'exception';
  match: {
    source: 'exception-text';
    fieldPath: string;
    matched: string;
    snippet: string;
  };
}

export type DouyinRiskEvidence = DouyinPageRiskEvidence | DouyinResponseRiskEvidence | DouyinExceptionRiskEvidence;

/** 可经 IPC / IndexedDB 保存的原始异常链；保留换行与完整堆栈，不使用摘要代替。 */
export interface DouyinOriginalError {
  name?: string;
  message: string;
  stack?: string;
  errorCode?: string;
  code?: string | number;
  cause?: DouyinOriginalError;
  circular?: true;
}
