import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'

export class CdkTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new ecr.Repository(this, 'our-cdk-ecr-repository', {
      repositoryName: 'our-cdk-ecr-repository',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteImages: true
    })

    const vpc = new ec2.Vpc(this, 'our-cdk-vpc', {
      vpcName: 'our-cdk-vpc',
      createInternetGateway: true, // default true
      subnetConfiguration: [{ name: 'cdk-public-subnet', subnetType: ec2.SubnetType.PUBLIC }],
    })
    
    const cluster = new ecs.Cluster(this, 'our-cdk-cluster', {
      vpc: vpc,
      clusterName: 'our-cdk-cluster',
      capacity: {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
      }
    })
    
    const image = ecs.ContainerImage.fromRegistry('qnanna/glovo_api:latest')

    const taskDefinition = new ecs.TaskDefinition(this, 'our-cdk-task-definition', {
      networkMode: ecs.NetworkMode.BRIDGE,
      compatibility: ecs.Compatibility.EC2,
      memoryMiB: '512',
      cpu: '1024',
    })
    taskDefinition.addContainer('task-definition-container', { 
      essential: true, 
      portMappings: [{
        containerPort: 3053,
        hostPort: 3000
      }],
      image, 
    })

    const service = new ecs.Ec2Service(this, 'our-cdk-service', {
      serviceName: 'our-cdk-service',
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
    })

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'our-cdk-target-group', {
      vpc: vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: {
        path: "/api/service/healthcheck", 
        timeout: cdk.Duration.seconds(5),
        interval: cdk.Duration.seconds(60),
      },
      targets: [service],
    })

    const lb = new elbv2.ApplicationLoadBalancer(this, 'our-cdk-load-balancer', {
      vpc: vpc,
      internetFacing: true,
    })

    const listener = lb.addListener('our-cdk-listener', {
      port: 80, 
      open: true,
      defaultTargetGroups: [targetGroup]
    })
    listener.addAction('/static', {
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/static'])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: '<h1>Static Auto Load Balancer Response</h1>',
      })
    })

    const serviceScaling = service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 2 })
    serviceScaling.scaleOnCpuUtilization('our-cdk-cpu-scaling', { targetUtilizationPercent: 90 })
    // serviceScaling.scaleOnRequestCount('our-cdk-requests-scaling', { requestsPerTarget: 900, targetGroup: targetGroup })

    new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: lb.loadBalancerDnsName })
  }
}
