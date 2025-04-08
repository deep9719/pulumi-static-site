import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Create S3 bucket with modern security settings
const siteBucket = new aws.s3.BucketV2("static-website-bucket", {
    // No ACLs - using bucket policy only
    tags: {
        Project: "StaticWebsite",
        ManagedBy: "Pulumi"
    }
});

// Set ownership controls (required for disabling ACLs)
const ownershipControls = new aws.s3.BucketOwnershipControls("ownership-controls", {
    bucket: siteBucket.id,
    rule: {
        objectOwnership: "BucketOwnerPreferred"
    }
});

// Configure public access block
const publicAccessBlock = new aws.s3.BucketPublicAccessBlock("public-access-block", {
    bucket: siteBucket.id,
    blockPublicAcls: false,
    ignorePublicAcls: false,
    blockPublicPolicy: false,
    restrictPublicBuckets: false
});

// Configure static website hosting
const websiteConfiguration = new aws.s3.BucketWebsiteConfigurationV2("website-config", {
    bucket: siteBucket.id,
    indexDocument: {
        suffix: "index.html"
    },
    errorDocument: {
        key: "error.html"
    }
}, { dependsOn: [ownershipControls, publicAccessBlock] });

// Bucket policy for public read access
const bucketPolicy = new aws.s3.BucketPolicy("bucket-policy", {
    bucket: siteBucket.id,
    policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: "*",
                Action: "s3:GetObject",
                Resource: pulumi.interpolate`${siteBucket.arn}/*`
            },
            {
                Effect: "Allow",
                Principal: "*",
                Action: "s3:GetBucketWebsite",
                Resource: siteBucket.arn
            }
        ]
    }),
}, { dependsOn: [publicAccessBlock, websiteConfiguration] });

// Upload website files
const indexHtml = new aws.s3.BucketObject("index.html", {
    bucket: siteBucket.id,
    key: "index.html",
    source: new pulumi.asset.StringAsset(`
        <!DOCTYPE html>
        <html>
        <head><title>My Static Site</title></head>
        <body><h1>Welcome to my Pulumi-deployed website!</h1></body>
        </html>
    `),
    contentType: "text/html",
    // No ACL - using bucket policy instead
});

const errorHtml = new aws.s3.BucketObject("error.html", {
    bucket: siteBucket.id,
    key: "error.html",
    source: new pulumi.asset.StringAsset(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body><h1>404 Not Found</h1></body>
        </html>
    `),
    contentType: "text/html",
    // No ACL - using bucket policy instead
});

// CloudFront distribution
const distribution = new aws.cloudfront.Distribution("static-site-distribution", {
    enabled: true,
    origins: [{
        originId: siteBucket.arn,
        domainName: websiteConfiguration.websiteEndpoint.apply(e => e.replace(/^https?:\/\//, '')),
        customOriginConfig: {
            originProtocolPolicy: "http-only",
            httpPort: 80,
            httpsPort: 443,
            originSslProtocols: ["TLSv1.2"],
        },
    }],
    defaultRootObject: "index.html",
    defaultCacheBehavior: {
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD", "OPTIONS"],
        targetOriginId: siteBucket.arn,
        viewerProtocolPolicy: "redirect-to-https",
        forwardedValues: {
            queryString: false,
            cookies: { forward: "none" },
        },
        minTtl: 0,
        defaultTtl: 3600,
        maxTtl: 86400
    },
    priceClass: "PriceClass_100",
    restrictions: {
        geoRestriction: {
            restrictionType: "none",
        },
    },
    viewerCertificate: {
        cloudfrontDefaultCertificate: true,
    },
    waitForDeployment: false,
    customErrorResponses: [{
        errorCode: 404,
        responseCode: 404,
        responsePagePath: "/error.html"
    }]
});

// Export the URLs
export const cloudfrontUrl = distribution.domainName;
export const s3WebsiteUrl = websiteConfiguration.websiteEndpoint;
export const bucketName = siteBucket.id;
export const distributionId = distribution.id;