interface INoStackError extends Error {
  message: string;
  name: string;
}

export class NoStackError extends Error implements INoStackError {
  constructor(message) {
    super(message);
    Error.captureStackTrace(this, this.constructor); // 스택을 현재 클래스 기준으로 수정
    this.stack = ""; // 스택을 아예 비워버림
  }
}
