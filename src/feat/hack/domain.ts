import { Server } from '@/utils/domain';

export interface ExtendedServerStats extends Server {
  tasks: ScheduledTask[];
}

export interface Task {
  target: string;
  action: string;
  result: number;
  threads: number;
  delay?: number;
  duration: number;
  comment?: string;
}

export interface ScheduledTask extends Task {
  finishesAt: number;
  runner: string;
  pid: number;
}
