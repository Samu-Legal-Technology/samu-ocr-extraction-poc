import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});

export async function startStateMachine(
  documentId: string,
  input: Record<string, any>,
  machineArn?: string
) {
  return await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: machineArn ?? process.env.STATE_MACHINE_ARN,
      // Prevent double runs
      // name: `Execution for ${documentId}`,
      input: JSON.stringify({
        documentId,
        ...input,
      }),
    })
  );
}
