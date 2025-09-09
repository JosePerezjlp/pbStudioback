import { ClassPayload } from "./ClassPayload";

export class ClassRequest {
  classes: ClassPayload[]|[];

  constructor() {
    this.classes = [];
  }
}