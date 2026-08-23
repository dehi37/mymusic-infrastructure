pipeline {
    agent {
        label 'built-in'
    }

    environment {
        AWS_REGION     = 'us-east-1'
        ROLE_ARN       = 'arn:aws:iam::049618906674:role/JenkinsDeploymentRole'
        DOMAIN_NAME    = 'dehi.click'
        SUB_DOMAIN     = 'www.mymusic'
        HOSTED_ZONE_ID = 'Z03387682Z76TKJHXQFER'
    }

    stages {
        stage('Determine Environment') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'prod') {
                        env.TARGET_ENV = 'prod'
                        env.VPC_CIDR   = '10.0.0.0/16'
                    } else if (env.BRANCH_NAME == 'dev') {
                        env.TARGET_ENV = 'dev'
                        env.VPC_CIDR   = '10.1.0.0/16'
                    } else {
                        error "Branche non autorisée : ${env.BRANCH_NAME}"
                    }
                    echo "=== DEPLOIEMENT AUTOMATIQUE SUR L'ENVIRONNEMENT : ${env.TARGET_ENV} ==="
                }
            }
        }

        stage('AWS STS AssumeRole') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'aws-jenkins-credentials', usernameVariable: 'AWS_ACCESS_KEY_ID', passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                    script {
                        def sts = sh(
                            script: """
                            aws sts assume-role \
                              --role-arn ${ROLE_ARN} \
                              --role-session-name JenkinsSession-${env.TARGET_ENV} \
                              --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
                              --output text
                            """,
                            returnStdout: true
                        ).trim().split('\t')

                        env.AWS_ACCESS_KEY_ID     = sts[0]
                        env.AWS_SECRET_ACCESS_KEY = sts[1]
                        env.AWS_SESSION_TOKEN     = sts[2]
                        env.AWS_DEFAULT_REGION    = AWS_REGION
                    }
                }
            }
        }

        stage('Deploy CloudFormation') {
            steps {
                script {
                    sh """
                    aws cloudformation deploy --template-file cloudformation/01-vpc.yml --stack-name mymusic-${env.TARGET_ENV}-vpc --parameter-overrides Env=${env.TARGET_ENV} VpcCidr=${env.VPC_CIDR} --no-fail-on-empty-changeset
                    aws cloudformation deploy --template-file cloudformation/02-security.yml --stack-name mymusic-${env.TARGET_ENV}-security --parameter-overrides Env=${env.TARGET_ENV} --no-fail-on-empty-changeset
                    aws cloudformation deploy --template-file cloudformation/03-database.yml --stack-name mymusic-${env.TARGET_ENV}-db --parameter-overrides Env=${env.TARGET_ENV} --no-fail-on-empty-changeset
                    aws cloudformation deploy --template-file cloudformation/04-alb-route53.yml --stack-name mymusic-${env.TARGET_ENV}-route53 --parameter-overrides Env=${env.TARGET_ENV} DomainName=${DOMAIN_NAME} HostedZoneId=${HOSTED_ZONE_ID} --no-fail-on-empty-changeset
                    aws cloudformation deploy --template-file cloudformation/05-ecs-fargate.yml --stack-name mymusic-${env.TARGET_ENV}-ecs --parameter-overrides Env=${env.TARGET_ENV} --no-fail-on-empty-changeset
                    aws cloudformation deploy --template-file cloudformation/06-lambda-sqs.yml --stack-name mymusic-${env.TARGET_ENV}-lambda --parameter-overrides Env=${env.TARGET_ENV} --no-fail-on-empty-changeset
                    """
                }
            }
        }
    }
}
