import { Server } from '@/utils/domain';

export interface ExtendedServerStats extends Server {
  tasks: ScheduledTask[];
}

export interface Task {
  target: string;
  action: string;
  threads: number;
  delay?: number;
}

export interface ScheduledTask extends Task {
  runner: string;
  pid: number;
}
